document.addEventListener('DOMContentLoaded', () => {
    // ========================================
    // 要素の取得
    // ========================================
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('camera-input'); // ID変更: camera-input
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
    // 画像リサイズ（Vercel 10秒制限対策）
    // ========================================
    async function resizeImage(file, maxSize = 1200) {
        return new Promise((resolve) => {
            // blueimp-load-imageでEXIF対応のリサイズ
            loadImage(
                file,
                (canvas) => {
                    if (canvas.type === 'error') {
                        console.warn('画像読み込みエラー、元ファイルを使用');
                        resolve(file);
                        return;
                    }

                    // リサイズ不要の場合はそのまま返す
                    if (canvas.width <= maxSize && canvas.height <= maxSize) {
                        console.log(`リサイズ不要: ${canvas.width}x${canvas.height}`);
                        resolve(file);
                        return;
                    }

                    // リサイズ済みの画像をBlobに変換
                    canvas.toBlob((blob) => {
                        const resizedFile = new File([blob], file.name, { type: 'image/jpeg' });
                        console.log(`リサイズ完了: ${file.size} → ${resizedFile.size} bytes (${canvas.width}x${canvas.height})`);
                        resolve(resizedFile);
                    }, 'image/jpeg', 0.9);
                },
                {
                    orientation: true,  // EXIF Orientationを自動処理
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

    // ========================================
    // 写真アップロード
    // ========================================
    // label の for 属性により、タップで自動的に input が発火
    // JavaScriptでの .click() は不要

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
    // Step 1: アップロード → クロップ編集画面
    // ========================================
    async function handleUpload(file) {
        console.log('=== handleUpload開始 ===', file.name);

        // 前回のBlobURLを解放
        cleanupBlobUrl();

        // 元のファイルを直接使用（EXIFメタデータを保持）
        // Canvas変換を行わないことで、EXIF情報が保持され回転バグを防ぐ
        const correctedImageUrl = URL.createObjectURL(file);
        currentBlobUrl = correctedImageUrl;
        cropPreview.src = correctedImageUrl;

        console.log('=== 切り抜き画面を表示 ===');

        // 即座に切り抜き編集画面に遷移
        uploadSection.classList.add('hidden');
        cropSection.classList.remove('hidden');

        console.log('=== cropSection表示状態 ===', {
            hidden: cropSection.classList.contains('hidden'),
            display: window.getComputedStyle(cropSection).display
        });

        // バックグラウンドで処理開始
        processInBackground(file);
    }

    // ========================================
    // バックグラウンド処理
    // ========================================
    async function processInBackground(file) {
        const processId = ++currentProcessId;

        // 処理状態のリセット
        serverProcessingState = {
            isProcessing: true,
            croppedImageUrl: null,
            detectedShopName: null,
            error: null
        };

        // 控えめなプログレス表示
        showBackgroundProgress('サーバー処理中...（この画面で編集可能）');

        try {
            // リサイズ処理
            const resizedFile = await resizeImage(file, 1200);

            // /analyze API呼び出し
            const formData = new FormData();
            formData.append('file', resizedFile);

            const response = await fetch('/analyze', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            console.log('=== API Response ===', data);

            // 古い処理結果は破棄（最新のみ反映）
            if (processId !== currentProcessId) {
                console.log('Stale response, ignoring');
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

            // クロップ済み画像が取得できたら自動更新
            if (data.image_url) {
                updateCropPreview(data.image_url);
            }

            // 店名が検出できたら通知
            if (data.shop_name && !data.shop_name.includes('判定不能')) {
                showToast('🚀 店名を自動検出しました');
            }

            hideBackgroundProgress();

        } catch (err) {
            // 古い処理結果は破棄
            if (processId !== currentProcessId) {
                return;
            }

            serverProcessingState.isProcessing = false;
            serverProcessingState.error = err.message;
            hideBackgroundProgress();
            showToast('⚠️ サーバー処理失敗（元画像を使用）', 5000);
            console.error('Background processing error:', err);
        }
    }

    // ========================================
    // プレビュー画像の動的更新
    // ========================================
    function updateCropPreview(croppedUrl) {
        const newImg = new Image();

        newImg.onload = () => {
            // スムーズなトランジション
            cropPreview.style.opacity = '0.5';
            setTimeout(() => {
                cropPreview.src = croppedUrl;
                cropPreview.style.opacity = '1';
                showToast('✨ クロップ済み画像に更新しました');
            }, 200);
        };

        newImg.onerror = () => {
            console.warn('Cropped image load failed, using raw image');
        };

        newImg.src = croppedUrl;
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
                    // 店名が空の場合のみ自動入力（ユーザーの手動入力を尊重）
                    if (!shopNameInput.value.trim()) {
                        shopNameInput.value = serverProcessingState.detectedShopName;
                        showToast('🚀 店名を自動検出しました');
                        editHint.textContent = '✅ GPS検出完了';
                        editHint.style.color = '#0f0';
                    }
                }
            }
        }, 500);

        // 最大10秒でタイムアウト
        setTimeout(() => clearInterval(checkInterval), 10000);
    }

    // ========================================
    // Step 2: クロップ完了 → 店名入力画面へ
    // ========================================
    cropDoneBtn.addEventListener('click', () => {
        // サーバー処理完了を待たずに進める
        const imageUrl = serverProcessingState.croppedImageUrl || cropPreview.src;
        previewImage.src = imageUrl;

        // 店名の自動入力（処理状態に応じて）
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

        cropSection.classList.add('hidden');
        editSection.classList.remove('hidden');

        // バックグラウンド処理完了後に店名を自動更新
        if (serverProcessingState.isProcessing) {
            watchForShopNameUpdate();
        }
    });

    cropCancelBtn.addEventListener('click', resetApp);

    // 戻るボタン（店名入力 → クロップ編集）
    backBtn.addEventListener('click', () => {
        editSection.classList.add('hidden');
        cropSection.classList.remove('hidden');
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

            resultImage.src = data.result_url + '?t=' + Date.now();
            resultShopName.textContent = '店名: ' + shopName;
            downloadLink.href = data.result_url;
            downloadLink.download = `ramen_${Date.now()}.jpg`;

            setupShare(data.result_url, shopName);

            loading.classList.add('hidden');
            resultSection.classList.remove('hidden');

        } catch (err) {
            loading.classList.add('hidden');
            editSection.classList.remove('hidden');
            alert('エラー: ' + err.message);
        }
    });

    // ========================================
    // リセット
    // ========================================
    resetBtn.addEventListener('click', resetApp);

    function resetApp() {
        // メモリリーク対策
        cleanupBlobUrl();

        uploadSection.classList.remove('hidden');
        loading.classList.add('hidden');
        cropSection.classList.add('hidden');
        editSection.classList.add('hidden');
        resultSection.classList.add('hidden');
        fileInput.value = '';
        shopNameInput.value = '';
        currentFilename = null;
        detectedShopName = null;

        // バックグラウンド処理の状態をリセット
        serverProcessingState = {
            isProcessing: false,
            croppedImageUrl: null,
            detectedShopName: null,
            error: null
        };

        // バックグラウンドプログレスを非表示
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
                    console.log('Share cancelled');
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

            console.log('=== News API Response ===', data);

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
            console.error('News fetch error:', err);
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


        // 店名リンクのクリックイベント（ラーメンデータベースへ）
        const shopNameLink = li.querySelector('.shop-name-link');
        shopNameLink.addEventListener('click', (e) => {
            e.stopPropagation();
            // shop.urlにはラーメンデータベースのURLが入っている
            if (shop.url) {
                window.open(shop.url, '_blank');
            }
        });

        // ナビボタンのクリックイベント（Googleマップへ）
        const naviBtn = li.querySelector('.navi-btn');
        naviBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const destination = encodeURIComponent(`${shop.name} ${metaInfo}`);
            const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
            window.open(mapsUrl, '_blank');
        });

        // 店名入力ボタン（店名を入力欄に反映）
        const setNameBtn = li.querySelector('.set-name-btn');
        if (setNameBtn) {
            setNameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                shopNameInput.value = shop.name;
                shopNameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // 視覚的フィードバック
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
