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
    const coordStatus = document.getElementById('coord-status');
    const coordValues = document.getElementById('coord-values');

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

    // Cropper.js インスタンス
    let cropperInstance = null;

    // ユーザーが枠を動かしたかどうかのフラグ（強制停止用）
    let userHasAdjusted = false;
    let cropMoveCount = 0;

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
    // ========================================
    function correctImageOrientation(file) {
        return new Promise((resolve) => {
            console.log('📐 EXIF回転補正開始:', file.name);

            loadImage(
                file,
                (canvas) => {
                    if (canvas.type === 'error') {
                        console.warn('⚠️ EXIF処理失敗 → 元ファイルを使用');
                        resolve(URL.createObjectURL(file));
                        return;
                    }

                    console.log('📐 EXIF補正後:', canvas.width + 'x' + canvas.height);

                    canvas.toBlob((blob) => {
                        const url = URL.createObjectURL(blob);
                        console.log('✅ EXIF回転を物理的に適用完了');
                        resolve(url);
                    }, 'image/jpeg', 0.92);
                },
                {
                    orientation: true,
                    canvas: true,
                    maxWidth: 1600,
                    maxHeight: 1600
                }
            );
        });
    }

    // ========================================
    // サーバー送信用リサイズ
    // ========================================
    async function resizeImage(file, maxSize) {
        return new Promise((resolve) => {
            loadImage(
                file,
                (canvas) => {
                    if (canvas.type === 'error') {
                        resolve(file);
                        return;
                    }
                    canvas.toBlob((blob) => {
                        resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                    }, 'image/jpeg', 0.9);
                },
                { orientation: true, canvas: true, maxWidth: maxSize, maxHeight: maxSize }
            );
        });
    }

    // ========================================
    // UI部品
    // ========================================
    function showBackgroundProgress(msg) {
        const el = document.getElementById('background-progress');
        if (el) el.remove();
        const div = document.createElement('div');
        div.id = 'background-progress';
        div.className = 'background-progress';
        div.innerHTML = '<div class="progress-content"><span class="spinner-small"></span><span>' + msg + '</span></div>';
        document.body.appendChild(div);
    }

    function hideBackgroundProgress() {
        const el = document.getElementById('background-progress');
        if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }
    }

    function showToast(msg, dur) {
        dur = dur || 3000;
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.classList.add('show'), 10);
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, dur);
    }

    function cleanupBlobUrl() {
        if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
    }

    function destroyCropper() {
        if (cropperInstance) {
            cropperInstance.destroy();
            cropperInstance = null;
            console.log('🔧 Cropperインスタンス破棄');
        }
    }

    // ========================================
    // 決定ボタンのロック制御
    // ========================================
    function lockDoneButton() {
        userHasAdjusted = false;
        cropMoveCount = 0;
        cropDoneBtn.disabled = true;
        cropDoneBtn.textContent = '🔒 まず枠を動かせ';
        cropDoneBtn.classList.add('locked');
        coordStatus.textContent = '⛔ 枠を動かせ';
        coordStatus.className = 'coord-error';
        coordValues.textContent = 'X:0 Y:0 W:0 H:0';
        console.log('🔒 決定ボタンをロック → ユーザーが枠を操作するまで進めない');
    }

    function unlockDoneButton() {
        if (!userHasAdjusted) {
            userHasAdjusted = true;
            cropDoneBtn.disabled = false;
            cropDoneBtn.textContent = '✅ この切り抜きで決定 → 店名入力へ';
            cropDoneBtn.classList.remove('locked');
            coordStatus.textContent = '✅ OK';
            coordStatus.className = 'coord-ok';
            console.log('🔓 決定ボタンをアンロック → ユーザーが枠を操作した');
        }
    }

    // ========================================
    // 座標のリアルタイム表示
    // ========================================
    function updateCoordDisplay(data) {
        const x = Math.round(data.x);
        const y = Math.round(data.y);
        const w = Math.round(data.width);
        const h = Math.round(data.height);
        coordValues.textContent = 'X:' + x + ' Y:' + y + ' W:' + w + ' H:' + h;

        if (w === 0 || h === 0) {
            coordStatus.textContent = '⛔ エラー: 幅・高さが0';
            coordStatus.className = 'coord-error';
            cropDoneBtn.disabled = true;
            cropDoneBtn.textContent = '⛔ 切り抜き範囲がない';
            console.error('❌ 切り抜き座標エラー: 幅または高さが0');
        }
    }

    // ========================================
    // 写真アップロード
    // ========================================
    fileInput.addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (f) handleUpload(f);
    });

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const f = e.dataTransfer.files[0];
        if (f && f.type.startsWith('image/')) handleUpload(f);
    });

    // ========================================
    // Step 1: アップロード → 切り抜き画面（強制停止）
    // ========================================
    async function handleUpload(file) {
        console.log('========================================');
        console.log('📸 写真を受け取った:', file.name, '(' + file.size + ' bytes)');
        console.log('========================================');

        appState = 'cropping';
        console.log('🔒 状態 → cropping（切り抜き画面を強制表示）');

        cleanupBlobUrl();
        destroyCropper();
        lockDoneButton();

        // EXIF回転を物理適用
        console.log('📐 Pixel 6a対応: EXIF回転を物理適用中...');
        const correctedUrl = await correctImageOrientation(file);
        currentBlobUrl = correctedUrl;

        // ★★★ 致命的バグ修正 ★★★
        // onloadハンドラをsrcセットの【前】に登録する
        // Blob URLは即座にロードされるので、src設定後にonloadを登録しても間に合わない
        console.log('🔧 onloadハンドラを先に登録（レースコンディション防止）');

        cropPreview.onload = () => {
            console.log('========================================');
            console.log('🖼️ 画像ロード完了 → Cropper.js を今から初期化する');
            console.log('========================================');

            // 画面が表示されていることを確認
            if (cropSection.classList.contains('hidden')) {
                console.error('❌ 異常: crop-sectionがhidden → 強制表示');
                cropSection.classList.remove('hidden');
            }

            // Cropper初期化（少し遅延させてDOMレンダリングを待つ）
            setTimeout(() => {
                initCropper();
            }, 100);
        };

        // 画面を先に表示
        uploadSection.classList.add('hidden');
        cropSection.classList.remove('hidden');
        console.log('🖼️ 切り抜き画面を表示した');
        console.log('⚠️ ユーザーが枠を動かして「決定」を押すまで絶対にスキップしない');

        // srcをセット → onloadが発火 → initCropper
        cropPreview.src = correctedUrl;
        console.log('🖼️ 画像srcをセット → onload待ち');

        // バックグラウンドでサーバー処理
        processInBackground(file);
    }

    // ========================================
    // Cropper.js 初期化
    // ========================================
    function initCropper() {
        destroyCropper();

        console.log('✂️ Cropper.js 初期化開始...');
        console.log('✂️ 対象要素:', cropPreview.tagName, cropPreview.naturalWidth + 'x' + cropPreview.naturalHeight);

        if (cropPreview.naturalWidth === 0) {
            console.error('❌ 画像のnaturalWidthが0 → 画像がまだロードされていない');
            console.log('⏳ 500ms後にリトライ...');
            setTimeout(() => initCropper(), 500);
            return;
        }

        cropperInstance = new Cropper(cropPreview, {
            aspectRatio: 1,
            viewMode: 1,
            dragMode: 'move',
            responsive: true,
            guides: true,
            center: true,
            background: true,
            autoCrop: true,
            autoCropArea: 0.85,
            movable: true,
            rotatable: false,
            scalable: true,
            zoomable: true,
            zoomOnTouch: true,
            zoomOnWheel: true,
            cropBoxMovable: true,
            cropBoxResizable: true,

            ready: function () {
                console.log('========================================');
                console.log('✅ Cropper.js 準備完了！切り抜き操作が可能');
                console.log('👆 枠をドラッグするか、ピンチで調整してください');
                console.log('========================================');

                // 丸型ガイド追加
                const cropBox = document.querySelector('.cropper-crop-box');
                if (cropBox) cropBox.classList.add('cropper-round');

                // 初期座標を表示
                const data = cropperInstance.getData();
                updateCoordDisplay(data);
                console.log('📐 初期座標: X=' + Math.round(data.x) + ' Y=' + Math.round(data.y) +
                    ' W=' + Math.round(data.width) + ' H=' + Math.round(data.height));
            },

            // ★ ユーザー操作を検知 → ボタンアンロック＋座標更新
            crop: function (event) {
                cropMoveCount++;
                const d = event.detail;
                updateCoordDisplay(d);

                // 2回以上のcropイベント = ユーザーが実際に枠を操作した
                // （初回はautoCropによる自動発火なのでスキップ）
                if (cropMoveCount > 1) {
                    unlockDoneButton();
                }
            },

            cropstart: function () {
                console.log('👆 ユーザーが切り抜き枠を触った');
            },

            cropmove: function () {
                unlockDoneButton();
            }
        });

        console.log('✂️ Cropper.jsインスタンス生成完了');
    }

    // ========================================
    // バックグラウンド処理（店名検出・サーバー保存）
    // ========================================
    async function processInBackground(file) {
        const pid = ++currentProcessId;
        console.log('📡 バックグラウンド処理開始 (ID:' + pid + ')');

        serverProcessingState = {
            isProcessing: true, croppedImageUrl: null,
            detectedShopName: null, error: null
        };

        showBackgroundProgress('サーバー処理中...（切り抜き操作は自由にできます）');

        try {
            const resized = await resizeImage(file, 1200);
            const fd = new FormData();
            fd.append('file', resized);

            console.log('📡 /analyze API呼び出し...');
            const resp = await fetch('/analyze', { method: 'POST', body: fd });
            const data = await resp.json();
            console.log('📡 APIレスポンス:', JSON.stringify(data, null, 2));

            if (pid !== currentProcessId) { console.log('⏭️ 古い結果 → 破棄'); return; }
            if (data.error) throw new Error(data.error);

            serverProcessingState.isProcessing = false;
            serverProcessingState.croppedImageUrl = data.image_url;
            serverProcessingState.detectedShopName = data.shop_name;
            currentFilename = data.filename;

            console.log('✅ サーバー処理完了: 店名=' + data.shop_name);

            if (data.shop_name && !data.shop_name.includes('判定不能')) {
                showToast('🚀 店名を自動検出: ' + data.shop_name);
            }
            hideBackgroundProgress();

        } catch (err) {
            if (pid !== currentProcessId) return;
            serverProcessingState.isProcessing = false;
            serverProcessingState.error = err.message;
            hideBackgroundProgress();
            showToast('⚠️ サーバー処理失敗（元画像を使用）', 5000);
            console.error('❌ バックグラウンドエラー:', err);
        }
    }

    // ========================================
    // リアルタイム店名更新
    // ========================================
    function watchForShopNameUpdate() {
        const iv = setInterval(() => {
            if (!serverProcessingState.isProcessing) {
                clearInterval(iv);
                const name = serverProcessingState.detectedShopName;
                if (name && !name.includes('判定不能') && !name.includes('特定できません')) {
                    if (!shopNameInput.value.trim()) {
                        shopNameInput.value = name;
                        showToast('🚀 店名を自動検出しました');
                        editHint.textContent = '✅ GPS検出完了';
                        editHint.style.color = '#0f0';
                    }
                }
            }
        }, 500);
        setTimeout(() => clearInterval(iv), 10000);
    }

    // ========================================
    // Step 2: 切り抜き決定 → 店名入力画面
    // ========================================
    cropDoneBtn.addEventListener('click', () => {
        console.log('========================================');
        console.log('✅ ユーザーが切り抜きを決定');
        console.log('========================================');

        if (appState !== 'cropping') {
            console.warn('⚠️ 状態不正:', appState);
            return;
        }

        if (!userHasAdjusted) {
            console.warn('⛔ ユーザーが枠を動かしていない → ブロック');
            showToast('⛔ まず枠をドラッグして調整してください', 3000);
            return;
        }

        // Cropper.jsから座標チェック
        if (cropperInstance) {
            const data = cropperInstance.getData();
            console.log('📐 最終座標: X=' + Math.round(data.x) + ' Y=' + Math.round(data.y) +
                ' W=' + Math.round(data.width) + ' H=' + Math.round(data.height));

            if (data.width === 0 || data.height === 0) {
                console.error('❌ 座標が0 → 進行をブロック');
                showToast('⛔ エラー: 切り抜き範囲がありません', 3000);
                return;
            }

            // 切り抜き画像を取得
            const canvas = cropperInstance.getCroppedCanvas({
                maxWidth: 1200,
                maxHeight: 1200,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high'
            });

            if (canvas) {
                const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                previewImage.src = dataUrl;
                console.log('✂️ 切り抜き完了: ' + canvas.width + 'x' + canvas.height);
                sendCroppedImage(dataUrl);
            } else {
                console.error('❌ getCroppedCanvasが失敗');
                previewImage.src = currentBlobUrl;
            }
        } else {
            console.error('❌ cropperInstanceがnull');
            previewImage.src = currentBlobUrl;
        }

        // 店名の自動入力
        const detected = serverProcessingState.detectedShopName;
        if (detected && !detected.includes('判定不能') && !detected.includes('特定できません')) {
            shopNameInput.value = detected;
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

        destroyCropper();

        appState = 'editing';
        console.log('🔒 状態 → editing');

        cropSection.classList.add('hidden');
        editSection.classList.remove('hidden');

        if (serverProcessingState.isProcessing) watchForShopNameUpdate();
    });

    // ========================================
    // 切り抜き画像をサーバーに送信
    // ========================================
    async function sendCroppedImage(dataUrl) {
        console.log('📤 切り抜き画像をサーバーに送信...');
        try {
            const resp = await fetch(dataUrl);
            const blob = await resp.blob();
            const fd = new FormData();
            fd.append('file', new File([blob], 'cropped.jpg', { type: 'image/jpeg' }));

            const result = await fetch('/api/simple-crop', { method: 'POST', body: fd });
            const data = await result.json();
            console.log('✅ サーバー保存完了:', data);

            if (data.success && data.filename) {
                currentFilename = data.filename;
            }
        } catch (err) {
            console.error('❌ 切り抜き送信失敗:', err);
        }
    }

    cropCancelBtn.addEventListener('click', () => {
        console.log('🚫 キャンセル');
        destroyCropper();
        resetApp();
    });

    backBtn.addEventListener('click', () => {
        console.log('⬅️ 戻る → 切り抜き画面');
        appState = 'cropping';
        lockDoneButton();

        editSection.classList.add('hidden');
        cropSection.classList.remove('hidden');

        if (currentBlobUrl) {
            cropPreview.onload = () => initCropper();
            cropPreview.src = '';  // 一旦リセット
            cropPreview.src = currentBlobUrl;
        }
    });

    // ========================================
    // Step 3: 保存処理
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
            showToast('⚠️ 画像の準備中です。もう少しお待ちください', 3000);
            return;
        }

        appState = 'saving';
        editSection.classList.add('hidden');
        loading.classList.remove('hidden');
        stepStatus.textContent = '🎨 ラベルを追加中...';

        try {
            const resp = await fetch('/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: currentFilename, shop_name: shopName })
            });
            const data = await resp.json();
            if (data.error) throw new Error(data.error);

            console.log('✅ ラベル追加完了:', data.result_url);

            resultImage.src = data.result_url + '?t=' + Date.now();
            resultShopName.textContent = '店名: ' + shopName;
            downloadLink.href = data.result_url;
            downloadLink.download = 'ramen_' + Date.now() + '.jpg';
            setupShare(data.result_url, shopName);

            appState = 'done';
            loading.classList.add('hidden');
            resultSection.classList.remove('hidden');

        } catch (err) {
            console.error('❌ 保存エラー:', err);
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
        console.log('🔄 リセット');
        cleanupBlobUrl();
        destroyCropper();
        appState = 'idle';

        uploadSection.classList.remove('hidden');
        loading.classList.add('hidden');
        cropSection.classList.add('hidden');
        editSection.classList.add('hidden');
        resultSection.classList.add('hidden');
        fileInput.value = '';
        shopNameInput.value = '';
        currentFilename = null;
        userHasAdjusted = false;
        cropMoveCount = 0;

        serverProcessingState = {
            isProcessing: false, croppedImageUrl: null,
            detectedShopName: null, error: null
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
                    const resp = await fetch(imageUrl);
                    const blob = await resp.blob();
                    const file = new File([blob], 'ramen.jpg', { type: 'image/jpeg' });
                    await navigator.share({ title: shopName, text: shopName + 'のラーメン 🍜', files: [file] });
                } catch (err) { console.log('共有キャンセル'); }
            } else {
                const a = document.createElement('a');
                a.href = imageUrl;
                a.download = shopName + '.jpg';
                a.click();
            }
        };
    }

    // ========================================
    // 新店情報
    // ========================================
    async function fetchNews() {
        const container = document.getElementById('shop-container');
        try {
            const resp = await fetch('/api/news');
            const data = await resp.json();
            if (!data.shops || data.shops.length === 0) {
                container.innerHTML = '<p class="empty-state">新店情報がありません</p>';
                return;
            }
            container.innerHTML = '';
            const ul = document.createElement('ul');
            ul.className = 'shop-list';
            data.shops.forEach(shop => ul.appendChild(createShopItem(shop)));
            container.appendChild(ul);
        } catch (err) {
            container.innerHTML = '<div class="empty-state"><p>データの取得に失敗しました</p></div>';
        }
    }

    function createShopItem(shop) {
        const li = document.createElement('li');
        li.className = 'shop-item';
        const metaParts = [];
        if (shop.station && shop.station.trim()) metaParts.push(shop.station);
        if (shop.city && shop.city.trim()) metaParts.push(shop.city);
        const metaInfo = metaParts.join(' / ');
        const prefCode = { '群馬': 'gunma', '栃木': 'tochigi', '埼玉': 'saitama', '茨城': 'ibaraki' }[shop.area] || 'default';

        li.innerHTML = '<div class="shop-header">' +
            '<span class="shop-area-badge" data-pref="' + prefCode + '">' + shop.area + '</span>' +
            '<span class="shop-name-link">' + shop.name + '</span>' +
            '<button class="set-name-btn">↑入力</button>' +
            '<button class="navi-btn">📍ナビ</button>' +
            '</div>' +
            '<div class="shop-meta">' + metaInfo + '</div>';

        li.querySelector('.shop-name-link').addEventListener('click', (e) => {
            e.stopPropagation();
            if (shop.url) window.open(shop.url, '_blank');
        });
        li.querySelector('.navi-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            window.open('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(shop.name + ' ' + metaInfo), '_blank');
        });
        const btn = li.querySelector('.set-name-btn');
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                shopNameInput.value = shop.name;
                shopNameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                btn.textContent = '✓';
                setTimeout(() => { btn.textContent = '↑入力'; }, 1000);
            });
        }
        return li;
    }

    fetchNews();
});
