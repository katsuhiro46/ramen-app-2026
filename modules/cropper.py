"""
画像処理モジュール - OpenCVどんぶり自動検知版
HoughCircles + 輪郭検出でどんぶりの位置を自動特定
"""
from PIL import Image, ExifTags
from io import BytesIO
import os

# OpenCV（Vercel環境でも動くheadless版）
try:
    import cv2
    import numpy as np
    HAS_CV2 = True
    print("✅ OpenCV利用可能")
except ImportError:
    HAS_CV2 = False
    print("⚠️ OpenCVなし → フォールバック検知を使用")


def apply_exif_rotation(img):
    """EXIF Orientationで画像を物理回転"""
    try:
        exif = img.getexif()
        if not exif:
            return img
        orientation = None
        for tag, value in exif.items():
            if ExifTags.TAGS.get(tag) == 'Orientation':
                orientation = value
                break
        if orientation is None:
            return img
        print(f"📐 EXIF Orientation: {orientation}")
        if orientation == 2:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        elif orientation == 3:
            img = img.rotate(180, expand=True)
        elif orientation == 4:
            img = img.transpose(Image.FLIP_TOP_BOTTOM)
        elif orientation == 5:
            img = img.transpose(Image.FLIP_LEFT_RIGHT).rotate(270, expand=True)
        elif orientation == 6:
            img = img.rotate(270, expand=True)
        elif orientation == 7:
            img = img.transpose(Image.FLIP_LEFT_RIGHT).rotate(90, expand=True)
        elif orientation == 8:
            img = img.rotate(90, expand=True)
        if orientation != 1:
            print("✅ EXIF回転適用完了")
        return img
    except Exception as e:
        print(f"⚠️ EXIF回転エラー: {e}")
        return img


def detect_bowl(image_path):
    """
    どんぶり（円形オブジェクト）を自動検知する

    戦略:
      1. OpenCV HoughCircles（最も正確）
      2. OpenCV 輪郭検出（フォールバック）
      3. 中央ヒューリスティック（最終手段）

    Returns:
        dict: { cx, cy, r } 全て画像サイズに対する比率（0.0〜1.0）
        cx = 中心X / 画像幅
        cy = 中心Y / 画像高さ
        r  = 半径 / min(幅, 高さ)
        None: 検知失敗
    """
    print("\n" + "=" * 70)
    print("🔍 どんぶり自動検知を開始")
    print("=" * 70)

    # まずPILで開いてEXIF回転を適用
    try:
        pil_img = Image.open(image_path)
        pil_img = apply_exif_rotation(pil_img)
        if pil_img.mode != 'RGB':
            pil_img = pil_img.convert('RGB')
        w, h = pil_img.size
        print(f"📸 画像サイズ: {w}x{h}")
    except Exception as e:
        print(f"❌ 画像読み込み失敗: {e}")
        return None

    if not HAS_CV2:
        print("⚠️ OpenCVなし → 中央ヒューリスティック")
        return _heuristic_center(w, h)

    # PIL → OpenCV(numpy配列)に変換
    img_array = np.array(pil_img)
    img_cv = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)

    # グレースケール化
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)

    # CLAHE（コントラスト強調）で低コントラスト画像でも検出精度向上
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # ノイズ除去
    blurred = cv2.GaussianBlur(gray, (9, 9), 2)

    min_dim = min(w, h)

    # ========================================
    # 戦略1: HoughCircles
    # ========================================
    result = _try_hough_circles(blurred, w, h, min_dim)
    if result:
        return result

    # ========================================
    # 戦略2: 輪郭検出
    # ========================================
    result = _try_contour_detection(blurred, w, h, min_dim)
    if result:
        return result

    # ========================================
    # 戦略3: 中央ヒューリスティック
    # ========================================
    print("⚠️ 全戦略失敗 → 中央ヒューリスティック")
    return _heuristic_center(w, h)


def _try_hough_circles(blurred, w, h, min_dim):
    """HoughCirclesで円を検出"""
    print("🔍 戦略1: HoughCircles...")

    # どんぶりのサイズ範囲を拡大（画像の短辺の15%〜50%が半径）
    min_r = int(min_dim * 0.15)
    max_r = int(min_dim * 0.50)

    # パラメータを複数パターン試行（幅広い検出戦略）
    param_sets = [
        (1.2, 80, 40),  # 標準
        (1.5, 60, 30),  # 緩め
        (1.0, 100, 50), # 厳しめ
        (1.3, 70, 35),  # 中間
        (1.8, 50, 25),  # 最緩
        (1.0, 60, 25),  # 高感度
    ]

    for dp, p1, p2 in param_sets:
        circles = cv2.HoughCircles(
            blurred,
            cv2.HOUGH_GRADIENT,
            dp=dp,
            minDist=min_dim // 3,
            param1=p1,
            param2=p2,
            minRadius=min_r,
            maxRadius=max_r
        )

        if circles is not None:
            circles = np.round(circles[0]).astype(int)
            # 最大の円を選択
            best = max(circles, key=lambda c: c[2])
            cx_ratio = float(best[0]) / w
            cy_ratio = float(best[1]) / h
            r_ratio = float(best[2]) / min_dim

            print(f"✅ HoughCircles検出成功!")
            print(f"   円: center=({best[0]},{best[1]}) radius={best[2]}")
            print(f"   比率: cx={cx_ratio:.3f} cy={cy_ratio:.3f} r={r_ratio:.3f}")
            print("=" * 70 + "\n")

            return {'cx': cx_ratio, 'cy': cy_ratio, 'r': r_ratio, 'method': 'hough'}

    print("   → HoughCircles: 検出なし")
    return None


def _try_contour_detection(blurred, w, h, min_dim):
    """輪郭検出で最大の円形オブジェクトを見つける"""
    print("🔍 戦略2: 輪郭検出...")

    edges = cv2.Canny(blurred, 30, 100)

    # モルフォロジー処理でエッジを繋げる
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    edges = cv2.dilate(edges, kernel, iterations=1)
    edges = cv2.erode(edges, kernel, iterations=1)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        print("   → 輪郭なし")
        return None

    # 面積が画像の5%以上の輪郭だけ対象
    min_area = w * h * 0.05
    valid_contours = [c for c in contours if cv2.contourArea(c) > min_area]

    if not valid_contours:
        print("   → 有効な輪郭なし")
        return None

    # 最も円形に近い大きな輪郭を選択
    best_contour = None
    best_score = 0

    for contour in valid_contours:
        area = cv2.contourArea(contour)
        perimeter = cv2.arcLength(contour, True)
        if perimeter == 0:
            continue

        # 円形度 = 4π × 面積 / 周囲長²（完全な円で1.0）
        circularity = 4 * 3.14159 * area / (perimeter * perimeter)

        # スコア = 円形度 × 面積（大きくて丸いものを優先）
        score = circularity * area

        if circularity > 0.3 and score > best_score:
            best_score = score
            best_contour = contour

    if best_contour is not None:
        (cx, cy), radius = cv2.minEnclosingCircle(best_contour)
        cx_ratio = float(cx) / w
        cy_ratio = float(cy) / h
        r_ratio = float(radius) / min_dim

        # 半径が極端に大きい/小さい場合は除外
        if 0.15 < r_ratio < 0.50:
            print(f"✅ 輪郭検出成功!")
            print(f"   円: center=({int(cx)},{int(cy)}) radius={int(radius)}")
            print(f"   比率: cx={cx_ratio:.3f} cy={cy_ratio:.3f} r={r_ratio:.3f}")
            print("=" * 70 + "\n")
            return {'cx': cx_ratio, 'cy': cy_ratio, 'r': r_ratio, 'method': 'contour'}

    print("   → 適切な円形輪郭なし")
    return None


def _heuristic_center(w, h):
    """
    最終手段: 中央ヒューリスティック
    ラーメン写真は通常、どんぶりが画面中央やや上に位置する
    """
    cx_ratio = 0.50
    cy_ratio = 0.45  # やや上寄り
    r_ratio = 0.42   # 画像短辺の42%

    print(f"📌 中央ヒューリスティック: cx={cx_ratio} cy={cy_ratio} r={r_ratio}")
    print("=" * 70 + "\n")

    return {'cx': cx_ratio, 'cy': cy_ratio, 'r': r_ratio, 'method': 'heuristic'}


def save_simple(image_data, output_path):
    """画像保存（EXIF回転適用）"""
    try:
        if isinstance(image_data, Image.Image):
            img = image_data.copy()
        elif isinstance(image_data, bytes):
            img = Image.open(BytesIO(image_data))
        elif isinstance(image_data, BytesIO):
            image_data.seek(0)
            img = Image.open(image_data)
        elif isinstance(image_data, str):
            if not os.path.exists(image_data):
                return False
            img = Image.open(image_data)
        else:
            return False

        img = apply_exif_rotation(img)
        if img.mode != 'RGB':
            img = img.convert('RGB')

        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)

        img.save(output_path, format='JPEG', quality=95)

        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            print(f"✅ 保存完了: {output_path}")
            return True
        return False

    except Exception as e:
        print(f"❌ 保存エラー: {e}")
        return False


def crop_bowl(image_path, output_path):
    """
    どんぶり検知→一撃切り抜き
    OpenCVでどんぶりを検知し、その位置で正方形切り抜きを実行
    """
    try:
        # まず画像を開いてEXIF回転
        img = Image.open(image_path)
        img = apply_exif_rotation(img)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        w, h = img.size

        # どんぶり検知
        bowl = detect_bowl(image_path)

        if bowl:
            cx = bowl['cx'] * w
            cy = bowl['cy'] * h
            r = bowl['r'] * min(w, h)

            # 正方形の切り抜き範囲を計算
            crop_size = int(r * 2)
            left = int(cx - r)
            top = int(cy - r)
            right = int(cx + r)
            bottom = int(cy + r)

            # 範囲チェック（画像外にはみ出さないように調整）
            if left < 0:
                right -= left
                left = 0
            if top < 0:
                bottom -= top
                top = 0
            if right > w:
                left -= (right - w)
                right = w
            if bottom > h:
                top -= (bottom - h)
                bottom = h

            # 再度範囲チェック
            left = max(0, left)
            top = max(0, top)
            right = min(w, right)
            bottom = min(h, bottom)

            # 正方形を維持
            crop_w = right - left
            crop_h = bottom - top
            if crop_w != crop_h:
                min_size = min(crop_w, crop_h)
                right = left + min_size
                bottom = top + min_size

            print(f"✂️ どんぶり一撃切り抜き: ({left},{top}) -> ({right},{bottom})")
            cropped = img.crop((left, top, right, bottom))
        else:
            # 検知失敗時は中央80%で切り抜き
            crop_size = int(min(w, h) * 0.80)
            left = (w - crop_size) // 2
            top = (h - crop_size) // 2
            right = left + crop_size
            bottom = top + crop_size
            print(f"📌 フォールバック中央切り抜き: ({left},{top}) -> ({right},{bottom})")
            cropped = img.crop((left, top, right, bottom))

        # 出力ディレクトリ確認
        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)

        # 保存
        cropped.save(output_path, format='JPEG', quality=95)
        print(f"✅ 切り抜き保存完了: {output_path}")
        return True

    except Exception as e:
        print(f"❌ 切り抜きエラー: {e}")
        import traceback
        traceback.print_exc()
        return False
