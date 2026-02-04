document.addEventListener('DOMContentLoaded', () => {
    console.log('🍜 ラーメンアプリ起動');

    // 要素
    const dropZone = document.getElementById('drop-zone');
    const cameraInput = document.getElementById('camera-input');
    const libraryInput = document.getElementById('library-input');
    const uploadSection = document.getElementById('upload-section');
    const loading = document.getElementById('loading');
    const stepStatus = document.getElementById('step-status');

    const cropSection = document.getElementById('crop-section');
    const cropPreview = document.getElementById('crop-preview');
    const cropDoneBtn = document.getElementById('crop-done-btn');
    const cropCancelBtn = document.getElementById('crop-cancel-btn');
    const coordStatus = document.getElementById('coord-status');
    const coordValues = document.getElementById('coord-values');

    const editSection = document.getElementById('edit-section');
    const previewImage = document.getElementById('preview-image');
    const shopNameInput = document.getElementById('shop-name');
    const editHint = document.getElementById('edit-hint');
    const saveBtn = document.getElementById('save-btn');
    const backBtn = document.getElementById('back-btn');

    const resultSection = document.getElementById('result-section');
    const resultImage = document.getElementById('result-image');
    const resultShopName = document.getElementById('result-shop-name');
    const downloadLink = document.getElementById('download-link');
    const shareBtn = document.getElementById('share-btn');
    const resetBtn = document.getElementById('reset-btn');

    let currentFilename = null;
    let cropperInstance = null;
    let appState = 'idle';
    let currentBlobUrl = null;
    let currentProcessId = 0;
    let bowlApplied = false;  // どんぶり検知が適用済みか

    let serverProcessingState = {
        isProcessing: false,
        detectedShopName: null,
        bowlData: null,
        error: null
    };

    // ========================================
    // EXIF回転補正
    // ========================================
    function correctImageOrientation(file) {
        return new Promise((resolve) => {
            console.log('📐 EXIF回転補正:', file.name);
            loadImage(file, (canvas) => {
                if (canvas.type === 'error') {
                    resolve(URL.createObjectURL(file));
                    return;
                }
                console.log('📐 補正後: ' + canvas.width + 'x' + canvas.height);
                canvas.toBlob((blob) => {
                    resolve(URL.createObjectURL(blob));
                }, 'image/jpeg', 0.92);
            }, { orientation: true, canvas: true, maxWidth: 1600, maxHeight: 1600 });
        });
    }

    function resizeImage(file, maxSize) {
        return new Promise((resolve) => {
            loadImage(file, (canvas) => {
                if (canvas.type === 'error') { resolve(file); return; }
                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                }, 'image/jpeg', 0.9);
            }, { orientation: true, canvas: true, maxWidth: maxSize, maxHeight: maxSize });
        });
    }

    // UI
    function showBackgroundProgress(msg) {
        var el = document.getElementById('background-progress');
        if (el) el.remove();
        var div = document.createElement('div');
        div.id = 'background-progress';
        div.className = 'background-progress';
        div.innerHTML = '<div class="progress-content"><span class="spinner-small"></span><span>' + msg + '</span></div>';
        document.body.appendChild(div);
    }
    function hideBackgroundProgress() {
        var el = document.getElementById('background-progress');
        if (el) { el.style.opacity = '0'; setTimeout(function() { el.remove(); }, 300); }
    }
    function showToast(msg, dur) {
        dur = dur || 3000;
        var t = document.createElement('div');
        t.className = 'toast'; t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() { t.classList.add('show'); }, 10);
        setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 300); }, dur);
    }
    function cleanupBlobUrl() {
        if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
    }
    function destroyCropper() {
        if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    }

    // ========================================
    // 座標表示
    // ========================================
    function updateCoordDisplay(data) {
        var x = Math.round(data.x), y = Math.round(data.y);
        var w = Math.round(data.width), h = Math.round(data.height);
        coordValues.textContent = 'X:' + x + ' Y:' + y + ' W:' + w + ' H:' + h;
    }

    // ========================================
    // 写真アップロード（カメラ・ライブラリ共通）
    // ========================================
    cameraInput.addEventListener('change', function(e) {
        var f = e.target.files[0];
        if (f) handleUpload(f);
    });
    libraryInput.addEventListener('change', function(e) {
        var f = e.target.files[0];
        if (f) handleUpload(f);
    });

    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', function(e) {
        e.preventDefault(); dropZone.classList.remove('dragover');
        var f = e.dataTransfer.files[0];
        if (f && f.type.startsWith('image/')) handleUpload(f);
    });

    // ========================================
    // Step 1: アップロード → 切り抜き画面
    // ========================================
    async function handleUpload(file) {
        console.log('========================================');
        console.log('📸 写真受信:', file.name, '(' + file.size + ' bytes)');

        appState = 'cropping';
        bowlApplied = false;
        cleanupBlobUrl();
        destroyCropper();

        // ボタンを「検知中」状態にする
        cropDoneBtn.disabled = true;
        cropDoneBtn.textContent = '⏳ どんぶり検知中...';
        cropDoneBtn.classList.add('locked');
        coordStatus.textContent = '⏳ 検知中...';
        coordStatus.className = 'coord-waiting';
        coordValues.textContent = 'X:0 Y:0 W:0 H:0';

        // EXIF回転
        var correctedUrl = await correctImageOrientation(file);
        currentBlobUrl = correctedUrl;

        // onloadを先に登録（レースコンディション防止）
        cropPreview.onload = function() {
            console.log('🖼️ 画像ロード完了 → Cropper.js初期化');
            if (cropSection.classList.contains('hidden')) {
                cropSection.classList.remove('hidden');
            }
            setTimeout(function() { initCropper(); }, 100);
        };

        // 画面表示
        uploadSection.classList.add('hidden');
        cropSection.classList.remove('hidden');

        // src設定 → onload発火
        cropPreview.src = correctedUrl;

        // バックグラウンドでサーバー処理（どんぶり検知 + 店名検出）
        processInBackground(file);
    }

    // ========================================
    // Cropper.js 初期化
    // ========================================
    function initCropper() {
        destroyCropper();

        if (cropPreview.naturalWidth === 0) {
            console.log('⏳ naturalWidth=0 → リトライ');
            setTimeout(function() { initCropper(); }, 500);
            return;
        }

        console.log('✂️ Cropper.js初期化: ' + cropPreview.naturalWidth + 'x' + cropPreview.naturalHeight);

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

            ready: function() {
                console.log('✅ Cropper.js準備完了');

                // 丸型ガイド
                var cropBox = document.querySelector('.cropper-crop-box');
                if (cropBox) cropBox.classList.add('cropper-round');

                // 初期座標表示
                var data = cropperInstance.getData();
                updateCoordDisplay(data);

                // サーバーからどんぶり座標が既に来ていたら即適用
                if (serverProcessingState.bowlData && !bowlApplied) {
                    applyBowlDetection(serverProcessingState.bowlData);
                }
            },

            crop: function(event) {
                updateCoordDisplay(event.detail);
            }
        });
    }

    // ========================================
    // どんぶり検知結果をCropper.jsに適用
    // ========================================
    function applyBowlDetection(bowl) {
        if (!cropperInstance || bowlApplied) return;
        bowlApplied = true;

        console.log('========================================');
        console.log('🎯 どんぶり検知結果を適用: method=' + bowl.method);
        console.log('   cx=' + bowl.cx.toFixed(3) + ' cy=' + bowl.cy.toFixed(3) + ' r=' + bowl.r.toFixed(3));

        var imageData = cropperInstance.getImageData();
        var natW = imageData.naturalWidth;
        var natH = imageData.naturalHeight;
        var minDim = Math.min(natW, natH);

        // 比率 → 実ピクセル座標に変換
        var cx = bowl.cx * natW;
        var cy = bowl.cy * natH;
        var r = bowl.r * minDim;

        // Cropper.jsのsetDataは左上座標 + 幅高さ
        var cropX = cx - r;
        var cropY = cy - r;
        var cropW = r * 2;
        var cropH = r * 2;

        // 範囲チェック
        if (cropX < 0) cropX = 0;
        if (cropY < 0) cropY = 0;
        if (cropX + cropW > natW) cropW = natW - cropX;
        if (cropY + cropH > natH) cropH = natH - cropY;

        console.log('📐 Cropper座標にセット: X=' + Math.round(cropX) + ' Y=' + Math.round(cropY) +
            ' W=' + Math.round(cropW) + ' H=' + Math.round(cropH));

        cropperInstance.setData({
            x: cropX,
            y: cropY,
            width: cropW,
            height: cropH
        });

        // 座標表示を更新
        updateCoordDisplay({ x: cropX, y: cropY, width: cropW, height: cropH });

        // ボタンをアンロック（自動検知成功 = 完璧な位置）
        cropDoneBtn.disabled = false;
        cropDoneBtn.textContent = '✅ この切り抜きで決定 → 店名入力へ';
        cropDoneBtn.classList.remove('locked');

        if (bowl.method === 'hough') {
            coordStatus.textContent = '🎯 AI検知: 完璧';
            coordStatus.className = 'coord-perfect';
            showToast('🎯 どんぶりを自動検知しました', 2000);
        } else if (bowl.method === 'contour') {
            coordStatus.textContent = '🎯 輪郭検知: 良好';
            coordStatus.className = 'coord-ok';
            showToast('🎯 どんぶり輪郭を検知しました', 2000);
        } else {
            coordStatus.textContent = '📌 推定位置';
            coordStatus.className = 'coord-ok';
        }

        console.log('✅ 切り抜き枠をどんぶり位置に自動セット完了');
        console.log('========================================');
    }

    // ========================================
    // バックグラウンド処理
    // ========================================
    async function processInBackground(file) {
        var pid = ++currentProcessId;
        serverProcessingState = {
            isProcessing: true, detectedShopName: null,
            bowlData: null, error: null
        };

        showBackgroundProgress('どんぶり検知 + 店名検出中...');

        try {
            var resized = await resizeImage(file, 1200);
            var fd = new FormData();
            fd.append('file', resized);

            var resp = await fetch('/analyze', { method: 'POST', body: fd });
            var data = await resp.json();
            console.log('📡 API応答:', JSON.stringify(data, null, 2));

            if (pid !== currentProcessId) return;
            if (data.error) throw new Error(data.error);

            serverProcessingState.isProcessing = false;
            serverProcessingState.detectedShopName = data.shop_name;
            serverProcessingState.bowlData = data.bowl;
            currentFilename = data.filename;

            // どんぶり検知結果をCropperに適用
            if (data.bowl && cropperInstance && !bowlApplied) {
                applyBowlDetection(data.bowl);
            } else if (data.bowl && !cropperInstance) {
                // Cropperがまだ未準備 → readyイベントで適用される
                console.log('📌 Cropper未準備 → ready時に適用予定');
            }

            // どんぶり検知なし + Cropper準備済みの場合はボタンアンロック
            if (!data.bowl && cropperInstance) {
                cropDoneBtn.disabled = false;
                cropDoneBtn.textContent = '✅ この切り抜きで決定 → 店名入力へ';
                cropDoneBtn.classList.remove('locked');
                coordStatus.textContent = '📌 手動調整';
                coordStatus.className = 'coord-ok';
            }

            if (data.shop_name && !data.shop_name.includes('判定不能')) {
                showToast('🚀 店名検出: ' + data.shop_name, 3000);
            }
            hideBackgroundProgress();

        } catch (err) {
            if (pid !== currentProcessId) return;
            serverProcessingState.isProcessing = false;
            serverProcessingState.error = err.message;
            hideBackgroundProgress();

            // エラーでもボタンはアンロック（手動操作を許可）
            cropDoneBtn.disabled = false;
            cropDoneBtn.textContent = '✅ この切り抜きで決定 → 店名入力へ';
            cropDoneBtn.classList.remove('locked');
            coordStatus.textContent = '⚠️ 手動調整';
            coordStatus.className = 'coord-ok';

            showToast('⚠️ サーバー処理失敗（手動調整可）', 5000);
            console.error('❌ エラー:', err);
        }
    }

    // 店名更新ウォッチャー
    function watchForShopNameUpdate() {
        var iv = setInterval(function() {
            if (!serverProcessingState.isProcessing) {
                clearInterval(iv);
                var name = serverProcessingState.detectedShopName;
                if (name && !name.includes('判定不能') && !name.includes('特定できません')) {
                    if (!shopNameInput.value.trim()) {
                        shopNameInput.value = name;
                        showToast('🚀 店名を自動検出');
                        editHint.textContent = '✅ GPS検出完了';
                        editHint.style.color = '#0f0';
                    }
                }
            }
        }, 500);
        setTimeout(function() { clearInterval(iv); }, 10000);
    }

    // ========================================
    // Step 2: 切り抜き決定
    // ========================================
    cropDoneBtn.addEventListener('click', function() {
        console.log('✅ 切り抜き決定');

        if (appState !== 'cropping') return;

        if (cropperInstance) {
            var data = cropperInstance.getData();
            if (data.width === 0 || data.height === 0) {
                showToast('⛔ 切り抜き範囲がありません', 3000);
                return;
            }

            var canvas = cropperInstance.getCroppedCanvas({
                maxWidth: 1200, maxHeight: 1200,
                imageSmoothingEnabled: true, imageSmoothingQuality: 'high'
            });
            if (canvas) {
                var dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                previewImage.src = dataUrl;
                console.log('✂️ 切り抜き: ' + canvas.width + 'x' + canvas.height);
                sendCroppedImage(dataUrl);
            } else {
                previewImage.src = currentBlobUrl;
            }
        } else {
            previewImage.src = currentBlobUrl;
        }

        // 店名自動入力
        var detected = serverProcessingState.detectedShopName;
        if (detected && !detected.includes('判定不能') && !detected.includes('特定できません')) {
            shopNameInput.value = detected;
            editHint.textContent = '🚀 GPSから店名を自動検出';
            editHint.style.color = '#0f0';
        } else if (serverProcessingState.isProcessing) {
            shopNameInput.value = '';
            editHint.textContent = '⏳ サーバー処理中... 手動入力も可能';
            editHint.style.color = '#ff9800';
        } else {
            shopNameInput.value = '';
            editHint.textContent = '💡 下のリストから店名をタップで反映できます';
            editHint.style.color = '#888';
        }

        destroyCropper();
        appState = 'editing';
        cropSection.classList.add('hidden');
        editSection.classList.remove('hidden');

        if (serverProcessingState.isProcessing) watchForShopNameUpdate();
    });

    // 切り抜き画像送信
    async function sendCroppedImage(dataUrl) {
        try {
            var resp = await fetch(dataUrl);
            var blob = await resp.blob();
            var fd = new FormData();
            fd.append('file', new File([blob], 'cropped.jpg', { type: 'image/jpeg' }));
            var result = await fetch('/api/simple-crop', { method: 'POST', body: fd });
            var data = await result.json();
            if (data.success && data.filename) currentFilename = data.filename;
        } catch (err) {
            console.error('❌ 送信失敗:', err);
        }
    }

    cropCancelBtn.addEventListener('click', function() { destroyCropper(); resetApp(); });

    backBtn.addEventListener('click', function() {
        appState = 'cropping';
        bowlApplied = false;
        editSection.classList.add('hidden');
        cropSection.classList.remove('hidden');

        cropDoneBtn.disabled = true;
        cropDoneBtn.textContent = '⏳ 再初期化中...';

        if (currentBlobUrl) {
            cropPreview.onload = function() {
                initCropper();
                // 前回の検知結果があれば再適用
                if (serverProcessingState.bowlData) {
                    setTimeout(function() {
                        if (cropperInstance) applyBowlDetection(serverProcessingState.bowlData);
                    }, 300);
                }
            };
            cropPreview.src = '';
            cropPreview.src = currentBlobUrl;
        }
    });

    // ========================================
    // Step 3: 保存
    // ========================================
    saveBtn.addEventListener('click', async function() {
        var shopName = shopNameInput.value.trim();
        if (!shopName) { alert('店名を入力してください'); shopNameInput.focus(); return; }
        if (!currentFilename) { showToast('⚠️ 画像の準備中です', 3000); return; }

        appState = 'saving';
        editSection.classList.add('hidden');
        loading.classList.remove('hidden');
        stepStatus.textContent = '🎨 ラベルを追加中...';

        try {
            var resp = await fetch('/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: currentFilename, shop_name: shopName })
            });
            var data = await resp.json();
            if (data.error) throw new Error(data.error);

            resultImage.src = data.result_url + '?t=' + Date.now();
            resultShopName.textContent = '店名: ' + shopName;
            downloadLink.href = data.result_url;
            downloadLink.download = 'ramen_' + Date.now() + '.jpg';
            setupShare(data.result_url, shopName);

            appState = 'done';
            loading.classList.add('hidden');
            resultSection.classList.remove('hidden');
        } catch (err) {
            loading.classList.add('hidden');
            editSection.classList.remove('hidden');
            appState = 'editing';
            alert('エラー: ' + err.message);
        }
    });

    // リセット
    resetBtn.addEventListener('click', resetApp);
    function resetApp() {
        cleanupBlobUrl(); destroyCropper();
        appState = 'idle'; bowlApplied = false;
        uploadSection.classList.remove('hidden');
        loading.classList.add('hidden');
        cropSection.classList.add('hidden');
        editSection.classList.add('hidden');
        resultSection.classList.add('hidden');
        cameraInput.value = ''; libraryInput.value = '';
        shopNameInput.value = ''; currentFilename = null;
        serverProcessingState = { isProcessing: false, detectedShopName: null, bowlData: null, error: null };
        hideBackgroundProgress();
    }

    // 共有
    function setupShare(imageUrl, shopName) {
        shareBtn.onclick = async function(e) {
            e.preventDefault();
            if (navigator.share) {
                try {
                    var resp = await fetch(imageUrl);
                    var blob = await resp.blob();
                    var file = new File([blob], 'ramen.jpg', { type: 'image/jpeg' });
                    await navigator.share({ title: shopName, text: shopName + 'のラーメン 🍜', files: [file] });
                } catch (err) {}
            } else {
                var a = document.createElement('a'); a.href = imageUrl; a.download = shopName + '.jpg'; a.click();
            }
        };
    }

    // 新店情報
    async function fetchNews() {
        var container = document.getElementById('shop-container');
        try {
            var resp = await fetch('/api/news');
            var data = await resp.json();
            if (!data.shops || data.shops.length === 0) {
                container.innerHTML = '<p class="empty-state">新店情報がありません</p>'; return;
            }
            container.innerHTML = '';
            var ul = document.createElement('ul'); ul.className = 'shop-list';
            data.shops.forEach(function(shop) { ul.appendChild(createShopItem(shop)); });
            container.appendChild(ul);
        } catch (err) {
            container.innerHTML = '<div class="empty-state"><p>データの取得に失敗しました</p></div>';
        }
    }

    function createShopItem(shop) {
        var li = document.createElement('li'); li.className = 'shop-item';
        var metaParts = [];
        if (shop.station && shop.station.trim()) metaParts.push(shop.station);
        if (shop.city && shop.city.trim()) metaParts.push(shop.city);
        var metaInfo = metaParts.join(' / ');
        var prefCode = { '群馬': 'gunma', '栃木': 'tochigi', '埼玉': 'saitama', '茨城': 'ibaraki' }[shop.area] || 'default';

        li.innerHTML = '<div class="shop-header">' +
            '<span class="shop-area-badge" data-pref="' + prefCode + '">' + shop.area + '</span>' +
            '<span class="shop-name-link">' + shop.name + '</span>' +
            '<button class="set-name-btn">↑入力</button>' +
            '<button class="navi-btn">📍ナビ</button></div>' +
            '<div class="shop-meta">' + metaInfo + '</div>';

        li.querySelector('.shop-name-link').addEventListener('click', function(e) {
            e.stopPropagation(); if (shop.url) window.open(shop.url, '_blank');
        });
        li.querySelector('.navi-btn').addEventListener('click', function(e) {
            e.stopPropagation();
            window.open('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(shop.name + ' ' + metaInfo), '_blank');
        });
        var btn = li.querySelector('.set-name-btn');
        if (btn) btn.addEventListener('click', function(e) {
            e.stopPropagation(); shopNameInput.value = shop.name;
            shopNameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            btn.textContent = '✓'; setTimeout(function() { btn.textContent = '↑入力'; }, 1000);
        });
        return li;
    }

    fetchNews();
});
