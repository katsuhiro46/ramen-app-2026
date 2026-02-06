document.addEventListener('DOMContentLoaded', () => {
    console.log('🍜 ラーメンアプリ起動');

    // ========================================
    // DOM Elements
    // ========================================
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

    // ========================================
    // State
    // ========================================
    let currentFilename = null;
    let appState = 'idle';
    let currentBlobUrl = null;

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

    // ========================================
    // UI Utilities
    // ========================================
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


    // ========================================
    // 写真アップロード
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
    // Step 1: アップロード → どんぶり一撃切り抜き → 店名入力
    // ========================================
    async function handleUpload(file) {
        console.log('========================================');
        console.log('📸 写真受信:', file.name, '(' + file.size + ' bytes)');

        appState = 'processing';
        cleanupBlobUrl();

        // ローディング表示
        uploadSection.classList.add('hidden');
        loading.classList.remove('hidden');
        stepStatus.textContent = '🔍 どんぶり検知 + 一撃切り抜き中...';

        try {
            // 画像をリサイズしてサーバーに送信
            var resized = await resizeImage(file, 1200);
            var fd = new FormData();
            fd.append('file', resized);

            var resp = await fetch('/analyze', { method: 'POST', body: fd });
            var data = await resp.json();
            console.log('📡 API応答:', JSON.stringify(data, null, 2));

            if (data.error) throw new Error(data.error);

            currentFilename = data.filename;

            // サーバーで切り抜き済みの画像を表示
            var imageUrl = data.image_url + '?t=' + Date.now();
            previewImage.src = imageUrl;

            // 店名自動入力
            var shopName = data.shop_name;
            if (shopName && !shopName.includes('判定不能') && !shopName.includes('特定できません')) {
                shopNameInput.value = shopName;
                editHint.textContent = '🚀 GPSから店名を自動検出';
                editHint.style.color = '#0f0';
            } else {
                shopNameInput.value = '';
                editHint.textContent = '💡 店名を入力してください';
                editHint.style.color = '#888';
            }

            // 検知方法を表示
            var bowlMethod = data.bowl ? data.bowl.method : 'fallback';
            if (bowlMethod === 'hough') {
                showToast('🎯 どんぶりをAI検知しました', 2000);
            } else if (bowlMethod === 'contour') {
                showToast('🎯 輪郭からどんぶりを検知', 2000);
            } else {
                showToast('📌 中央切り抜きを適用', 2000);
            }

            // ローディング非表示 → 店名入力画面へ
            loading.classList.add('hidden');
            editSection.classList.remove('hidden');
            appState = 'editing';

        } catch (err) {
            console.error('❌ 処理エラー:', err);
            loading.classList.add('hidden');
            uploadSection.classList.remove('hidden');
            appState = 'idle';
            showToast('⚠️ 処理に失敗しました: ' + err.message, 5000);
        }
    }

    // 戻るボタン → アップロード画面に戻る
    backBtn.addEventListener('click', function() {
        resetApp();
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
        cleanupBlobUrl();
        appState = 'idle';
        uploadSection.classList.remove('hidden');
        loading.classList.add('hidden');
        cropSection.classList.add('hidden');
        editSection.classList.add('hidden');
        resultSection.classList.add('hidden');
        cameraInput.value = ''; libraryInput.value = '';
        shopNameInput.value = ''; currentFilename = null;
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

    // ========================================
    // ラーメンマップ（Leaflet.js + OpenStreetMap）
    // ========================================
    var ramenMap = null;
    var mapMarkers = [];

    function initRamenMap() {
        var mapEl = document.getElementById('ramen-map');
        if (!mapEl || typeof L === 'undefined') {
            console.log('📍 マップ初期化スキップ（要素なしまたはLeaflet未読み込み）');
            return;
        }

        // デフォルト: 東京駅
        ramenMap = L.map('ramen-map', {
            zoomControl: false,
            attributionControl: false
        }).setView([35.6762, 139.6503], 14);

        // ズームコントロール右下
        L.control.zoom({ position: 'bottomright' }).addTo(ramenMap);

        // OpenStreetMap タイル（ダークテーマ風）
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        }).addTo(ramenMap);

        // 位置情報取得
        var statusEl = document.getElementById('map-status');
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                function(pos) {
                    var lat = pos.coords.latitude;
                    var lon = pos.coords.longitude;
                    console.log('📍 現在地:', lat, lon);

                    ramenMap.setView([lat, lon], 15);

                    // 現在地マーカー
                    L.marker([lat, lon], {
                        icon: L.divIcon({
                            className: 'user-marker',
                            html: '<div class="user-dot"></div>',
                            iconSize: [16, 16],
                            iconAnchor: [8, 8]
                        })
                    }).addTo(ramenMap).bindPopup('現在地');

                    // 周辺ラーメン店検索
                    searchNearbyRamen(lat, lon);
                },
                function(err) {
                    console.log('📍 位置情報取得失敗:', err.message);
                    if (statusEl) statusEl.textContent = '📍 位置情報を許可してください';
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        } else {
            if (statusEl) statusEl.textContent = '📍 位置情報非対応';
        }
    }

    function searchNearbyRamen(lat, lon) {
        var statusEl = document.getElementById('map-status');
        if (statusEl) statusEl.textContent = '🔍 周辺のラーメン店を検索中...';

        fetch('/api/nearby-ramen?lat=' + lat + '&lon=' + lon)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.shops && data.shops.length > 0) {
                    // ラーメン店のみ表示（APIがラーメン店のみ返す）
                    if (statusEl) statusEl.textContent = '🍜 ' + data.shops.length + '件のラーメン店';

                    data.shops.forEach(function(shop) {
                        if (shop.lat && shop.lon) {
                            // ラーメンアイコンのみ（フォークとナイフは表示しない）
                            var icon = L.divIcon({
                                className: 'ramen-marker',
                                html: '<div class="ramen-pin" style="background:#E60012">🍜</div>',
                                iconSize: [32, 32],
                                iconAnchor: [16, 16]
                            });

                            var marker = L.marker([shop.lat, shop.lon], { icon: icon })
                                .addTo(ramenMap);

                            var popupHtml = '<b>' + shop.name + '</b><br>' +
                                '<span style="color:#888">' + shop.distance + 'm</span>' +
                                '<br><a href="https://www.google.com/maps/dir/?api=1&destination=' +
                                shop.lat + ',' + shop.lon +
                                '" target="_blank" style="color:#4285f4;text-decoration:none;font-weight:bold">' +
                                '📍 Google Maps ナビ</a>';

                            marker.bindPopup(popupHtml);
                            mapMarkers.push(marker);
                        }
                    });
                } else {
                    if (statusEl) statusEl.textContent = '周辺にラーメン店が見つかりませんでした';
                }
            })
            .catch(function(err) {
                console.error('Map search error:', err);
                if (statusEl) statusEl.textContent = '検索に失敗しました';
            });
    }

    // ========================================
    // 新店情報（県別アコーディオン）
    // ========================================
    async function fetchNews() {
        var container = document.getElementById('shop-container');
        try {
            var resp = await fetch('/api/news');
            var data = await resp.json();
            if (!data.shops || data.shops.length === 0) {
                container.innerHTML = '<p class="empty-state">新店情報がありません</p>';
                return;
            }

            // 県別にグループ化
            var groups = {};
            var prefOrder = ['群馬', '栃木', '茨城', '埼玉'];
            var prefCodes = {
                '群馬': 'gunma',
                '栃木': 'tochigi',
                '埼玉': 'saitama',
                '茨城': 'ibaraki'
            };

            data.shops.forEach(function(shop) {
                var area = shop.area || '不明';
                if (!groups[area]) groups[area] = [];
                groups[area].push(shop);
            });

            container.innerHTML = '';

            prefOrder.forEach(function(pref) {
                if (!groups[pref]) return;
                var shops = groups[pref];
                var code = prefCodes[pref] || 'default';

                // アコーディオングループ
                var group = document.createElement('div');
                group.className = 'accordion-group';

                // ヘッダー（タップで開閉）
                var header = document.createElement('div');
                header.className = 'accordion-header';
                header.innerHTML =
                    '<span class="accordion-badge" data-pref="' + code + '">' + pref + '</span>' +
                    '<span class="accordion-title">' + pref + ' の新店 (' + shops.length + '件)</span>' +
                    '<span class="accordion-arrow">▶</span>';

                // コンテンツ（初期状態は非表示）
                var content = document.createElement('div');
                content.className = 'accordion-content';
                content.style.display = 'none';

                var ul = document.createElement('ul');
                ul.className = 'shop-list';
                shops.forEach(function(shop) {
                    ul.appendChild(createShopItem(shop));
                });
                content.appendChild(ul);

                // タップで開閉
                header.addEventListener('click', function() {
                    var isOpen = content.style.display !== 'none';
                    content.style.display = isOpen ? 'none' : 'block';
                    header.querySelector('.accordion-arrow').textContent = isOpen ? '▶' : '▼';
                    header.classList.toggle('active', !isOpen);
                });

                group.appendChild(header);
                group.appendChild(content);
                container.appendChild(group);
            });

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

        li.innerHTML = '<div class="shop-header">' +
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

    // ========================================
    // 初期化
    // ========================================
    initRamenMap();
    fetchNews();
});
