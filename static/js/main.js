document.addEventListener('DOMContentLoaded', () => {
    console.log('========================================');
    console.log('🍜 ラーメンアプリ 起動');
    console.log('========================================');

    // ========================================
    // 要素の取得
    // ========================================
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('camera-input');
    const uploadSection = document.getElementById('upload-section');
    const loading = document.getElementById('loading');
    const stepStatus = document.getElementById('step-status');

    // クロップ編集画面
    const cropSection = document.getElementById('crop-section');
    const cropPreview = document.getElementById('crop-preview');
    const cropDoneBtn = document.getElementById('crop-done-btn');
    const cropCancelBtn = document.getElementById('crop-cancel-btn');

    // 店名入力画面
    const editSection = document.getElementById('edit-section');
    const previewImage = document.getElementById('preview-image');
    const shopNameInput = document.getElementById('shop-name');
    const editHint = document.getElementById('edit-hint');
    const saveBtn = document.getElementById('save-btn');
    const backBtn = document.getElementById('back-btn');

    // 結果画面
    const resultSection = document.getElementById('result-section');
    const resultImage = document.getElementById('result-image');
    const resultShopName = document.getElementById('result-shop-name');
    const downloadLink = document.getElementById('download-link');
    const shareBtn = document.getElementById('share-btn');
    const resetBtn = document.getElementById('reset-btn');

    let currentFilename = null;
    let croppedImageUrl = null;
    let detectedShopName = null;

    // Cropper.js インスタンス
    let cropperInstance = null;

    // 画面状態の管理（素通りバグ防止）
    let appState = 'idle'; // idle | cropping | editing | saving | done

    // バックグラウンド処理用の変数
    let currentBlobUrl = null;
    let currentProcessId = 0;
    let serverProcessingState = {
        isProcessing: false,
        croppedImageUrl: null,
        detectedShopName: null,
        error: null
    };

    // ========================================
    // EXIF回転を物理的に適用して正しい向きの画像を返す
    // Pixel 6a等で横向き撮影された画像を確実に補正する
    // ========================================
    function correctImageOrientation(file) {
        return new Promise((resolve) => {
            console.log('📐 EXIF回転補正を開始:', file.name, `(${file.size} bytes)`);

            loadImage(
                file,
                (canvas) => {
                    if (canvas.type === 'error') {
                        console.warn('⚠️ EXIF処理失敗、元ファイルを使用');
                        resolve(URL.createObjectURL(file));
                        return;
                    }

                    console.log(`📐 EXIF補正後のサイズ: ${canvas.width}x${canvas.height}`);

                    // Canvasから Blob URL を生成（物理的に回転済み）
                    canvas.toBlob((blob) => {
                        const correctedUrl = URL.createObjectURL(blob);
                        console.log('✅ EXIF回転補正完了 → 物理的に正しい向きの画像を生成');
                        resolve(correctedUrl);
                    }, 'image/jpeg', 0.92);
                },
                {
                    orientation: true,  // EXIF Orientationを物理的に適用
                    canvas: true,
                    maxWidth: 1600,
                    maxHeight: 1600
                }
            );
        });
    }

    // ========================================
    // サーバー送信用リサイズ（EXIF適用済み）
    // ========================================
    async function resizeImage(file, maxSize = 1200) {
        return new Promise((resolve) => {
            loadImage(
                file,
                (canvas) => {
                    if (canvas.type === 'error') {
                        console.warn('⚠️ リサイズ失敗、元ファイルを使用');
                        resolve(file);
                        return;
                    }

                    canvas.toBlob((blob) => {
                        const resizedFile = new File([blob], file.name, { type: 'image/jpeg' });
                        console.log(`📦 サーバー送信用リサイズ: ${file.size} → ${resizedFile.size} bytes (${canvas.width}x${canvas.height})`);
                        resolve(resizedFile);
                    }, 'image/jpeg', 0.9);
                },
                {
                    orientation: true,
                    canvas: true,
                    maxWidth: maxSize,
                    maxHeight: maxSize
                }
            );
        });
    }

    // ========================================
    // UI部品（トースト・プログレスバー）
    // ========================================
    function showBackgroundProgress(message) {
        const existing = document.getElementById('background-progress');
        if (existing) existing.remove();

        const progressBar = document.createElement('div');
        progressBar.id = 'background-progress';
        progressBar.className = 'background-progress';
        progressBar.innerHTML = `
            <div class="progress-content">
                <span class="spinner-small"></span>
                <span>${message}</span>
            </div>
        `;
        document.body.appendChild(progressBar);
    }

    function hideBackgroundProgress() {
        const progressBar = document.getElementById('background-progress');
        if (progressBar) {
            progressBar.style.opacity = '0';
            setTimeout(() => progressBar.remove(), 300);
        }
    }

    function showToast(message, duration = 3000) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('show');
        }, 10);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    function cleanupBlobUrl() {
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
        }
    }

    function destroyCropper() {
        if (cropperInstance) {
            cropperInstance.destroy();
            cropperInstance = null;
            console.log('🔧 Cropperインスタンスを破棄');
        }
    }

    // ========================================
    // 写真アップロード
    // ========================================
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleUpload(file);
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleUpload(file);
        }
    });

    // ========================================
    // Step 1: アップロード → 切り抜き編集画面
    // ========================================
    async function handleUpload(file) {
        console.log('========================================');
        console.log('📸 handleUpload開始:', file.name, `(${file.size} bytes, ${file.type})`);
        console.log('========================================');

        // 状態を「切り抜き中」に設定（素通り防止）
        appState = 'cropping';
        console.log('🔒 アプリ状態 → cropping（切り抜き画面をロック）');

        // 前回のリソースを解放
        cleanupBlobUrl();
        destroyCropper();

        // EXIF回転を物理的に適用してから表示
        console.log('📐 Pixel 6a対応: EXIF回転を物理的に適用中...');
        const correctedImageUrl = await correctImageOrientation(file);
        currentBlobUrl = correctedImageUrl;

        // 切り抜きプレビューに設定
        cropPreview.src = correctedImageUrl;

        console.log('🖼️ 切り抜き画面を表示します');
        console.log('⚠️ ユーザーが「決定」を押すまで、この画面は絶対にスキップしません');

        // 即座に切り抜き編集画面に遷移
        uploadSection.classList.add('hidden');
        cropSection.classList.remove('hidden');

        // Cropper.js を画像読み込み後に初期化
        cropPreview.onload = () => {
            console.log('🖼️ 画像読み込み完了 → Cropper.js を初期化');
            initCropper();
        };

        console.log('📡 バックグラウンドでサーバー処理を開始（店名検出等）');
        // バックグラウンドで処理開始（切り抜き画面はそのまま維持）
        processInBackground(file);
    }

    // ========================================
    // Cropper.js 初期化 - どんぶりギリギリ切り抜き
    // ========================================
    function initCropper() {
        destroyCropper();

        console.log('✂️ Cropper.js 初期化: 丸型ガイド付き自由切り抜き');

        cropperInstance = new Cropper(cropPreview, {
            // 丸型に見える1:1比率（どんぶり形状に最適）
            aspectRatio: 1,
            // ドラッグで切り抜き枠を移動
            viewMode: 1,
            // 画像全体を表示
            dragMode: 'move',
            // レスポンシブ
            responsive: true,
            // 切り抜きガイドライン表示
            guides: true,
            // 中心マーク表示
            center: true,
            // 背景グリッド
            background: true,
            // 自動切り抜き（初期枠を自動配置）
            autoCrop: true,
            // 初期切り抜き枠を画像の80%に設定（どんぶりギリギリ）
            autoCropArea: 0.85,
            // モバイルタッチ対応
            movable: true,
            rotatable: false,
            scalable: true,
            zoomable: true,
            zoomOnTouch: true,
            zoomOnWheel: true,
            // 切り抜き枠のサイズ変更可能
            cropBoxMovable: true,
            cropBoxResizable: true,
            // 丸型表示のためのクラス
            ready: function () {
                console.log('✅ Cropper.js 準備完了 → 切り抜き操作可能');
                console.log('👆 ピンチで拡大縮小、ドラッグで位置調整');

                // 丸型ビューガイドを追加
                const cropBox = document.querySelector('.cropper-crop-box');
                if (cropBox) {
                    cropBox.classList.add('cropper-round');
                }
            }
        });
    }

    // ========================================
    // バックグラウンド処理（店名検出・サーバー保存）
    // ========================================
    async function processInBackground(file) {
        const processId = ++currentProcessId;
        console.log(`📡 バックグラウンド処理開始 (ID: ${processId})`);

        // 処理状態のリセット
        serverProcessingState = {
            isProcessing: true,
            croppedImageUrl: null,
            detectedShopName: null,
            error: null
        };

        showBackgroundProgress('サーバー処理中...（切り抜き操作は可能です）');

        try {
            const resizedFile = await resizeImage(file, 1200);

            const formData = new FormData();
            formData.append('file', resizedFile);

            console.log('📡 /analyze API 呼び出し中...');
            const response = await fetch('/analyze', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            console.log('📡 API レスポンス受信:', JSON.stringify(data, null, 2));

            // 古い処理結果は破棄（最新のみ反映）
            if (processId !== currentProcessId) {
                console.log('⏭️ 古い処理結果を破棄（新しいアップロードが開始済み）');
                return;
            }

            if (data.error) {
                throw new Error(data.error);
            }

            // 処理完了状態の更新
            serverProcessingState.isProcessing = false;
            serverProcessingState.croppedImageUrl = data.image_url;
            serverProcessingState.detectedShopName = data.shop_name;
            currentFilename = data.filename;
            croppedImageUrl = data.image_url;
            detectedShopName = data.shop_name;

            console.log('✅ サーバー処理完了');
            console.log(`  店名: ${data.shop_name}`);
            console.log(`  検出方法: ${data.detection_method}`);

            if (data.shop_name && !data.shop_name.includes('判定不能')) {
                showToast('🚀 店名を自動検出しました');
            }

            hideBackgroundProgress();

        } catch (err) {
            if (processId !== currentProcessId) return;

            serverProcessingState.isProcessing = false;
            serverProcessingState.error = err.message;
            hideBackgroundProgress();
            showToast('⚠️ サーバー処理失敗（元画像を使用）', 5000);
            console.error('❌ バックグラウンド処理エラー:', err);
        }
    }

    // ========================================
    // リアルタイム店名更新
    // ========================================
    function watchForShopNameUpdate() {
        const checkInterval = setInterval(() => {
            if (!serverProcessingState.isProcessing) {
                clearInterval(checkInterval);

                if (serverProcessingState.detectedShopName &&
                    !serverProcessingState.detectedShopName.includes('判定不能') &&
                    !serverProcessingState.detectedShopName.includes('特定できません')) {
                    if (!shopNameInput.value.trim()) {
                        shopNameInput.value = serverProcessingState.detectedShopName;
                        showToast('🚀 店名を自動検出しました');
                        editHint.textContent = '✅ GPS検出完了';
                        editHint.style.color = '#0f0';
                    }
                }
            }
        }, 500);

        setTimeout(() => clearInterval(checkInterval), 10000);
    }

    // ========================================
    // Step 2: 切り抜き決定 → 店名入力画面へ
    // ========================================
    cropDoneBtn.addEventListener('click', () => {
        console.log('========================================');
        console.log('✅ ユーザーが切り抜きを決定しました');
        console.log('========================================');

        if (appState !== 'cropping') {
            console.warn('⚠️ 状態不正: 現在の状態は', appState, '（cropping以外では操作不可）');
            return;
        }

        // Cropper.jsから切り抜き画像を取得
        let croppedDataUrl = null;
        if (cropperInstance) {
            const croppedCanvas = cropperInstance.getCroppedCanvas({
                maxWidth: 1200,
                maxHeight: 1200,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high'
            });

            if (croppedCanvas) {
                croppedDataUrl = croppedCanvas.toDataURL('image/jpeg', 0.92);
                console.log(`✂️ 切り抜き完了: ${croppedCanvas.width}x${croppedCanvas.height}`);
            }
        }

        // 切り抜き画像をプレビューに設定
        if (croppedDataUrl) {
            previewImage.src = croppedDataUrl;
            console.log('🖼️ 切り抜き済み画像をプレビューに設定');

            // 切り抜き画像をサーバーに送信（バックグラウンド）
            sendCroppedImage(croppedDataUrl);
        } else {
            // Cropper取得失敗時はサーバーの画像を使用
            const fallbackUrl = serverProcessingState.croppedImageUrl || cropPreview.src;
            previewImage.src = fallbackUrl;
            console.log('🖼️ フォールバック: サーバー画像を使用');
        }

        // 店名の自動入力
        if (serverProcessingState.detectedShopName &&
            !serverProcessingState.detectedShopName.includes('判定不能') &&
            !serverProcessingState.detectedShopName.includes('特定できません')) {
            shopNameInput.value = serverProcessingState.detectedShopName;
            editHint.textContent = '🚀 GPSから店名を自動検出しました';
            editHint.style.color = '#0f0';
        } else if (serverProcessingState.isProcessing) {
            shopNameInput.value = '';
            editHint.textContent = '⏳ サーバー処理中... 手動入力も可能です';
            editHint.style.color = '#ff9800';
        } else {
            shopNameInput.value = '';
            editHint.textContent = '💡 下のリストから店名をタップで反映できます';
            editHint.style.color = '#888';
        }

        // Cropperを破棄してから画面遷移
        destroyCropper();

        // 画面遷移
        appState = 'editing';
        console.log('🔒 アプリ状態 → editing（店名入力画面）');

        cropSection.classList.add('hidden');
        editSection.classList.remove('hidden');

        // バックグラウンド処理完了後に店名を自動更新
        if (serverProcessingState.isProcessing) {
            watchForShopNameUpdate();
        }
    });

    // ========================================
    // 切り抜き画像をサーバーに送信
    // ========================================
    async function sendCroppedImage(dataUrl) {
        console.log('📤 切り抜き画像をサーバーに送信中...');

        try {
            // DataURLをBlobに変換
            const response = await fetch(dataUrl);
            const blob = await response.blob();

            const formData = new FormData();
            formData.append('file', new File([blob], 'cropped.jpg', { type: 'image/jpeg' }));

            const result = await fetch('/api/simple-crop', {
                method: 'POST',
                body: formData
            });

            const data = await result.json();
            console.log('✅ 切り抜き画像をサーバーに保存:', data);

            if (data.success && data.filename) {
                currentFilename = data.filename;
                croppedImageUrl = data.image_url;
            }
        } catch (err) {
            console.error('❌ 切り抜き画像の送信に失敗:', err);
        }
    }

    cropCancelBtn.addEventListener('click', () => {
        console.log('🚫 ユーザーが切り抜きをキャンセル');
        destroyCropper();
        resetApp();
    });

    // 戻るボタン（店名入力 → 切り抜き編集）
    backBtn.addEventListener('click', () => {
        console.log('⬅️ 店名入力 → 切り抜き画面に戻る');

        appState = 'cropping';
        console.log('🔒 アプリ状態 → cropping');

        editSection.classList.add('hidden');
        cropSection.classList.remove('hidden');

        // Cropperを再初期化
        if (currentBlobUrl) {
            cropPreview.src = currentBlobUrl;
            cropPreview.onload = () => {
                initCropper();
            };
        }
    });

    // ========================================
    // Step 3: 保存処理（店名ラベルを追加）
    // ========================================
    saveBtn.addEventListener('click', async () => {
        const shopName = shopNameInput.value.trim();
        if (!shopName) {
            alert('店名を入力してください');
            shopNameInput.focus();
            return;
        }

        console.log('========================================');
        console.log('💾 保存処理開始:', shopName);
        console.log('========================================');

        if (!currentFilename) {
            console.error('❌ ファイル名が未設定 → サーバー処理が完了していない可能性');
            showToast('⚠️ 画像の準備中です。もう少しお待ちください', 3000);
            return;
        }

        appState = 'saving';
        console.log('🔒 アプリ状態 → saving');

        editSection.classList.add('hidden');
        loading.classList.remove('hidden');
        stepStatus.textContent = '🎨 ラベルを追加中...';

        try {
            const response = await fetch('/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: currentFilename,
                    shop_name: shopName
                })
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            console.log('✅ ラベル追加完了:', data.result_url);

            resultImage.src = data.result_url + '?t=' + Date.now();
            resultShopName.textContent = '店名: ' + shopName;
            downloadLink.href = data.result_url;
            downloadLink.download = `ramen_${Date.now()}.jpg`;

            setupShare(data.result_url, shopName);

            appState = 'done';
            console.log('🔒 アプリ状態 → done（完了）');

            loading.classList.add('hidden');
            resultSection.classList.remove('hidden');

        } catch (err) {
            console.error('❌ 保存処理エラー:', err);
            loading.classList.add('hidden');
            editSection.classList.remove('hidden');
            appState = 'editing';
            alert('エラー: ' + err.message);
        }
    });

    // ========================================
    // リセット
    // ========================================
    resetBtn.addEventListener('click', resetApp);

    function resetApp() {
        console.log('🔄 アプリをリセット');

        // リソース解放
        cleanupBlobUrl();
        destroyCropper();

        appState = 'idle';
        console.log('🔒 アプリ状態 → idle');

        uploadSection.classList.remove('hidden');
        loading.classList.add('hidden');
        cropSection.classList.add('hidden');
        editSection.classList.add('hidden');
        resultSection.classList.add('hidden');
        fileInput.value = '';
        shopNameInput.value = '';
        currentFilename = null;
        detectedShopName = null;

        serverProcessingState = {
            isProcessing: false,
            croppedImageUrl: null,
            detectedShopName: null,
            error: null
        };

        hideBackgroundProgress();
    }

    // ========================================
    // 共有機能
    // ========================================
    function setupShare(imageUrl, shopName) {
        shareBtn.onclick = async (e) => {
            e.preventDefault();

            if (navigator.share) {
                try {
                    const response = await fetch(imageUrl);
                    const blob = await response.blob();
                    const file = new File([blob], 'ramen.jpg', { type: 'image/jpeg' });

                    await navigator.share({
                        title: shopName,
                        text: `${shopName}のラーメン 🍜`,
                        files: [file]
                    });
                } catch (err) {
                    console.log('共有キャンセル');
                }
            } else {
                const a = document.createElement('a');
                a.href = imageUrl;
                a.download = `${shopName}.jpg`;
                a.click();
            }
        };
    }

    // ========================================
    // 新店情報の取得
    // ========================================
    async function fetchNews() {
        const container = document.getElementById('shop-container');

        try {
            const response = await fetch('/api/news');
            const data = await response.json();

            console.log('📰 新店情報:', data.shops ? data.shops.length + '件' : '0件');

            if (!data.shops || data.shops.length === 0) {
                container.innerHTML = '<p class="empty-state">新店情報がありません</p>';
                return;
            }

            container.innerHTML = '';
            const ul = document.createElement('ul');
            ul.className = 'shop-list';

            data.shops.forEach(shop => {
                const li = createShopItem(shop);
                ul.appendChild(li);
            });

            container.appendChild(ul);

        } catch (err) {
            console.error('📰 新店情報の取得に失敗:', err);
            container.innerHTML = `
                <div class="empty-state">
                    <p>データの取得に失敗しました</p>
                </div>
            `;
        }
    }

    function createShopItem(shop) {
        const li = document.createElement('li');
        li.className = 'shop-item';

        const metaParts = [];
        if (shop.station && shop.station.trim()) {
            metaParts.push(shop.station);
        }
        if (shop.city && shop.city.trim()) {
            metaParts.push(shop.city);
        }
        const metaInfo = metaParts.join(' / ');

        const prefCode = {
            '群馬': 'gunma',
            '栃木': 'tochigi',
            '埼玉': 'saitama',
            '茨城': 'ibaraki'
        }[shop.area] || 'default';

        li.innerHTML = `
            <div class="shop-header">
                <span class="shop-area-badge" data-pref="${prefCode}">${shop.area}</span>
                <span class="shop-name-link">${shop.name}</span>
                <button class="set-name-btn">↑入力</button>
                <button class="navi-btn">📍ナビ</button>
            </div>
            <div class="shop-meta">${metaInfo}</div>
        `;

        const shopNameLink = li.querySelector('.shop-name-link');
        shopNameLink.addEventListener('click', (e) => {
            e.stopPropagation();
            if (shop.url) {
                window.open(shop.url, '_blank');
            }
        });

        const naviBtn = li.querySelector('.navi-btn');
        naviBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const destination = encodeURIComponent(`${shop.name} ${metaInfo}`);
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
            window.open(mapsUrl, '_blank');
        });

        const setNameBtn = li.querySelector('.set-name-btn');
        if (setNameBtn) {
            setNameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                shopNameInput.value = shop.name;
                shopNameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });

                setNameBtn.textContent = '✓';
                setTimeout(() => {
                    setNameBtn.textContent = '↑入力';
                }, 1000);
            });
        }

        return li;
    }

    // 初期化
    fetchNews();
});
