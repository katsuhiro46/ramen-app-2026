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

    // ========================================
    // 画像リサイズ（Vercel 10秒制限対策）
    // ========================================
    async function resizeImage(file, maxSize = 1200) {
        return new Promise((resolve) => {
            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            img.onload = () => {
                let { width, height } = img;

                // 長辺がmaxSize以下なら、リサイズ不要
                if (width <= maxSize && height <= maxSize) {
                    console.log(`リサイズ不要: ${width}x${height}`);
                    resolve(file);
                    return;
                }

                // アスペクト比を維持してリサイズ
                if (width > height) {
                    height = Math.round((height * maxSize) / width);
                    width = maxSize;
                } else {
                    width = Math.round((width * maxSize) / height);
                    height = maxSize;
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    const resizedFile = new File([blob], file.name, { type: 'image/jpeg' });
                    console.log(`リサイズ完了: ${file.size} → ${resizedFile.size} bytes (${width}x${height})`);
                    resolve(resizedFile);
                }, 'image/jpeg', 0.9);
            };

            img.onerror = () => {
                console.warn('画像読み込みエラー、元ファイルを使用');
                resolve(file);
            };

            img.src = URL.createObjectURL(file);
        });
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
        uploadSection.classList.add('hidden');
        loading.classList.remove('hidden');
        stepStatus.textContent = '📐 画像をリサイズ中...';

        // Vercel 10秒制限対策: ブラウザ側でリサイズ
        const resizedFile = await resizeImage(file, 1200);

        stepStatus.textContent = '✂️ 画像をクロップ中...';

        const formData = new FormData();
        formData.append('file', resizedFile);

        try {
            const response = await fetch('/analyze', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            console.log('=== API Response ===', data);

            if (data.error) {
                throw new Error(data.error);
            }

            currentFilename = data.filename;
            croppedImageUrl = data.image_url;
            detectedShopName = data.shop_name;

            // クロップ済み画像をプレビュー
            cropPreview.src = croppedImageUrl;

            loading.classList.add('hidden');
            cropSection.classList.remove('hidden');

        } catch (err) {
            loading.classList.add('hidden');
            uploadSection.classList.remove('hidden');
            alert('エラー: ' + err.message);
        }
    }

    // ========================================
    // Step 2: クロップ完了 → 店名入力画面へ
    // ========================================
    cropDoneBtn.addEventListener('click', () => {
        // 加工済み画像を店名入力画面に表示
        previewImage.src = croppedImageUrl;

        // 店名を設定（GPSから検出できた場合は自動入力）
        if (detectedShopName &&
            !detectedShopName.includes('判定不能') &&
            !detectedShopName.includes('特定できません')) {
            shopNameInput.value = detectedShopName;
            editHint.textContent = '🚀 GPSから店名を自動検出しました';
            editHint.style.color = '#0f0';
        } else {
            shopNameInput.value = '';
            editHint.textContent = '💡 下のリストから店名をタップで反映できます';
            editHint.style.color = '#888';
        }

        cropSection.classList.add('hidden');
        editSection.classList.remove('hidden');
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
        uploadSection.classList.remove('hidden');
        loading.classList.add('hidden');
        cropSection.classList.add('hidden');
        editSection.classList.add('hidden');
        resultSection.classList.add('hidden');
        fileInput.value = '';
        shopNameInput.value = '';
        currentFilename = null;
        detectedShopName = null;
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
