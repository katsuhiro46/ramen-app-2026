"""
GPS座標から店名を特定するモジュール - ラーメン店限定版
非ラーメン店は除外する
"""
import requests
from typing import Optional, List, Dict
import math
import re


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """2点間の距離を計算（メートル）"""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c


def is_ramen_shop(name: str, cuisine: str = '') -> bool:
    """
    ラーメン店かどうか厳格に判定
    店名に「ラーメン」が含まれる OR cuisine=ramen のみ許可
    """
    # 厳格なラーメンキーワード（ラーメン専門店のみ）
    strict_keywords = [
        'ラーメン', 'らーめん', 'らぁめん', '拉麺',
        '中華そば', 'つけ麺', '担々麺', 'タンタン麺',
        '麺屋', '麺や', '麺処', '麺家', '麺道',
    ]

    name_check = name.lower()
    cuisine_check = cuisine.lower()

    # cuisine に ramen が含まれていれば OK
    if 'ramen' in cuisine_check:
        return True

    # 店名にラーメン関連キーワードが含まれていれば OK
    for kw in strict_keywords:
        if kw in name or kw.lower() in name_check:
            return True

    return False


def is_excluded_shop(name: str) -> bool:
    """除外するべき店舗か判定"""
    excluded = [
        'マクドナルド', 'McDonald', 'ドミノ', 'ピザ', 'Pizza',
        'ケンタッキー', 'KFC', 'すき家', '吉野家', '松屋',
        'ガスト', 'サイゼリヤ', 'デニーズ', 'ジョナサン',
        'スターバックス', 'ドトール', 'タリーズ',
        'コンビニ', 'セブン', 'ファミマ', 'ローソン'
    ]
    
    for ex in excluded:
        if ex in name:
            return True
    
    return False


def search_nearby_ramen(lat: float, lon: float, radius: int = 300) -> List[Dict]:
    """
    Overpass APIで周辺のラーメン店のみを厳格に検索
    cuisine=ramen または ramen_restaurant のみ
    """
    candidates = []

    try:
        # ラーメン専用の厳格なクエリ
        query = f"""
        [out:json][timeout:15];
        (
          node["cuisine"~"ramen"](around:{radius},{lat},{lon});
          way["cuisine"~"ramen"](around:{radius},{lat},{lon});
        );
        out body center;
        """

        url = "https://overpass-api.de/api/interpreter"
        print(f"[Overpass] Searching RAMEN ONLY within {radius}m")

        response = requests.post(url, data={'data': query}, timeout=20)
        data = response.json()

        elements = data.get('elements', [])
        print(f"[Overpass] Found {len(elements)} ramen elements")

        for elem in elements:
            tags = elem.get('tags', {})
            name = tags.get('name', tags.get('name:ja', ''))
            cuisine = tags.get('cuisine', '')

            if not name:
                continue

            # 除外リストに該当するものはスキップ
            if is_excluded_shop(name):
                print(f"  Excluded: {name}")
                continue

            # 座標を取得（way の場合は center を使用）
            if elem.get('type') == 'way':
                center = elem.get('center', {})
                elem_lat = center.get('lat', lat)
                elem_lon = center.get('lon', lon)
            else:
                elem_lat = elem.get('lat', lat)
                elem_lon = elem.get('lon', lon)

            distance = haversine_distance(lat, lon, elem_lat, elem_lon)

            # 厳格なラーメン判定（cuisine に ramen が含まれるもののみ）
            cuisine_lower = cuisine.lower()
            if 'ramen' not in cuisine_lower:
                # cuisine が ramen でない場合は店名で再判定
                if not is_ramen_shop(name, cuisine):
                    print(f"  ❌ Not ramen: {name} (cuisine={cuisine})")
                    continue

            candidates.append({
                'name': name,
                'distance': distance,
                'lat': elem_lat,
                'lon': elem_lon,
                'is_ramen': True,  # この関数はラーメン店のみ返す
                'cuisine': cuisine,
                'source': 'overpass'
            })

            print(f"  🍜 {name} ({distance:.0f}m) cuisine={cuisine}")

    except Exception as e:
        print(f"[Overpass] Error: {e}")

    return candidates


def find_shop_by_gps(lat: float, lon: float, ocr_text: str = None) -> Dict:
    """
    GPS座標からラーメン店名を特定（メイン関数）
    
    ルール:
    1. まずラーメン店を優先検索
    2. 見つからなければ全飲食店を候補表示
    3. ユーザーが候補から選択可能
    """
    print("=" * 50)
    print(f"[GPS Search] {lat:.6f}, {lon:.6f}")
    if ocr_text:
        print(f"[OCR] {ocr_text[:50]}...")
    print("=" * 50)
    
    result = {
        'shop_name': None,
        'gps_detected': True,
        'lat': lat,
        'lon': lon,
        'distance': None,
        'method': 'none',
        'candidates': [],
        'debug_info': f"GPS: {lat:.6f}, {lon:.6f}"
    }
    
    all_candidates = []

    # Step 1: 500m以内を検索
    print("\n--- Restaurant Search (500m) ---")
    candidates_500 = search_nearby_ramen(lat, lon, 500)
    all_candidates.extend(candidates_500)

    # Step 2: 見つからなければ2kmに拡大
    if len(all_candidates) < 3:
        print("\n--- Restaurant Search (2km) ---")
        candidates_2k = search_nearby_ramen(lat, lon, 2000)
        for c in candidates_2k:
            if c['name'] not in [x['name'] for x in all_candidates]:
                all_candidates.append(c)

    # Step 3: まだ少なければ5kmに拡大
    if len(all_candidates) < 3:
        print("\n--- Restaurant Search (5km) ---")
        candidates_5k = search_nearby_ramen(lat, lon, 5000)
        for c in candidates_5k:
            if c['name'] not in [x['name'] for x in all_candidates]:
                all_candidates.append(c)
    
    print(f"\n[Total] {len(all_candidates)} candidates")
    
    # 50m以内の店舗を最優先
    within_50m = [c for c in all_candidates if c.get('distance', 9999) <= 50]
    beyond_50m = [c for c in all_candidates if c.get('distance', 9999) > 50]
    
    # それぞれラーメン店とその他に分類
    within_50m_ramen = [c for c in within_50m if c.get('is_ramen')]
    within_50m_other = [c for c in within_50m if not c.get('is_ramen')]
    beyond_50m_ramen = [c for c in beyond_50m if c.get('is_ramen')]
    beyond_50m_other = [c for c in beyond_50m if not c.get('is_ramen')]
    
    # 距離順にソート
    within_50m_ramen.sort(key=lambda x: x.get('distance', 9999))
    within_50m_other.sort(key=lambda x: x.get('distance', 9999))
    beyond_50m_ramen.sort(key=lambda x: x.get('distance', 9999))
    beyond_50m_other.sort(key=lambda x: x.get('distance', 9999))
    
    # 優先順位:
    # 1. 50m以内のラーメン店
    # 2. 50m以内のその他飲食店
    # 3. 50m以上のラーメン店
    # 4. 50m以上のその他飲食店
    all_sorted = within_50m_ramen + within_50m_other + beyond_50m_ramen + beyond_50m_other
    
    ramen_count = len(within_50m_ramen) + len(beyond_50m_ramen)
    print(f"[Priority] 50m以内: {len(within_50m)}件, ラーメン店: {ramen_count}件")
    
    # デバッグ出力
    print("\n=== All Candidates ===")
    for i, c in enumerate(all_sorted[:5]):
        ramen_mark = "🍜" if c.get('is_ramen') else "  "
        print(f"  {i+1}. {ramen_mark} {c['name']} ({c['distance']:.0f}m)")

    
    # 結果を設定
    result['candidates'] = all_sorted[:5]
    
    # 選択ロジック
    if within_50m_ramen:
        # 50m以内にラーメン店がある場合は自動選択
        best = within_50m_ramen[0]
        result['shop_name'] = best['name']
        result['distance'] = best['distance']
        result['method'] = 'ramen_50m'
        result['debug_info'] = f"GPS: {lat:.6f}, {lon:.6f} | {best['name']} ({best['distance']:.0f}m)"
        print(f"\n✅ Auto-selected (50m ramen): {best['name']} ({best['distance']:.0f}m)")
    elif within_50m_other:
        # 50m以内に他の飲食店がある場合も自動選択（確認用）
        best = within_50m_other[0]
        result['shop_name'] = best['name']
        result['distance'] = best['distance']
        result['method'] = 'restaurant_50m'
        result['debug_info'] = f"GPS: {lat:.6f}, {lon:.6f} | {best['name']} ({best['distance']:.0f}m) ※要確認"
        print(f"\n⚠️ Auto-selected (50m other): {best['name']} ({best['distance']:.0f}m)")
    elif beyond_50m_ramen:
        # 50m以上のラーメン店
        best = beyond_50m_ramen[0]
        result['shop_name'] = best['name']
        result['distance'] = best['distance']
        result['method'] = 'ramen_search'
        result['debug_info'] = f"GPS: {lat:.6f}, {lon:.6f} | {best['name']} ({best['distance']:.0f}m)"
        print(f"\n✅ Selected (ramen): {best['name']} ({best['distance']:.0f}m)")
    elif all_sorted:
        # その他の飲食店のみ
        result['shop_name'] = None  # ユーザーに選択させる
        result['method'] = 'needs_selection'
        result['debug_info'] = f"GPS: {lat:.6f}, {lon:.6f} | ラーメン店なし（候補から選択してください）"
        print("\n⚠️ No ramen shop found. User selection required.")

    else:
        # 飲食店が見つからない
        result['shop_name'] = None
        result['method'] = 'not_found'
        result['debug_info'] = f"GPS: {lat:.6f}, {lon:.6f} | 周辺に飲食店が見つかりませんでした"
        print("\n❌ No restaurant found nearby")
    
    return result



def find_shop_without_gps(ocr_text: str = None) -> Dict:
    """GPS情報なしの場合のフォールバック"""
    result = {
        'shop_name': None,
        'gps_detected': False,
        'lat': None,
        'lon': None,
        'distance': None,
        'method': 'ocr_only',
        'candidates': [],
        'debug_info': "GPS未検出（EXIFなし）"
    }
    
    print("[OCR Fallback] No GPS")
    
    if not ocr_text:
        return result
    
    ramen_keywords = ['ラーメン', 'らーめん', 'らぁめん', '麺屋', '麺処', '中華そば']
    
    for line in ocr_text.split('\n'):
        line = line.strip()
        if 2 <= len(line) <= 25:
            for kw in ramen_keywords:
                if kw in line:
                    result['shop_name'] = line
                    result['debug_info'] += f" | OCR: {line}"
                    return result
    
    return result
