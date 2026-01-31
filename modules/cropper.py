"""
画像処理モジュール - Pillow軽量版
Vercelで確実に動作する最小構成
丼の縁ギリギリを攻めた円形クロップ、外側は黒
"""
from PIL import Image, ImageDraw
from io import BytesIO


def crop_bowl_tight(img):
    """
    丼の縁ギリギリを攻めた円形クロップ

    - 画像の短辺の95%を使用（丼の縁ギリギリ）
    - 中央から正方形を切り出し
    - 円形マスクを適用、外側は黒

    Args:
        img: PIL Image

    Returns:
        処理済みPIL Image (RGB、円の外側は黒)
    """
    width, height = img.size

    # 短辺を基準に、95%のサイズで切り出し（丼の縁ギリギリ）
    min_side = min(width, height)
    crop_size = int(min_side * 0.95)

    # 中央からクロップ
    center_x = width // 2
    center_y = height // 2

    left = center_x - crop_size // 2
    top = center_y - crop_size // 2
    right = left + crop_size
    bottom = top + crop_size

    # 境界チェック
    if left < 0:
        left = 0
        right = crop_size
    if top < 0:
        top = 0
        bottom = crop_size
    if right > width:
        right = width
        left = width - crop_size
    if bottom > height:
        bottom = height
        top = height - crop_size

    # 正方形にクロップ
    cropped = img.crop((left, top, right, bottom))

    # RGBに変換
    if cropped.mode != 'RGB':
        cropped = cropped.convert('RGB')

    # 黒背景の画像を作成
    size = cropped.size[0]
    output = Image.new('RGB', (size, size), (0, 0, 0))

    # 円形マスクを作成
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)

    # マスクを適用して円の内側だけを黒背景に貼り付け
    output.paste(cropped, (0, 0), mask)

    return output


def crop_bowl(image_data, output_path=None):
    """
    丼の縁ギリギリ円形クロップ

    Args:
        image_data: PIL Image, bytes, BytesIO, またはファイルパス
        output_path: 保存先パス（省略時はBytesIOで返す）

    Returns:
        output_pathが指定されている場合: True/False
        output_pathが省略されている場合: BytesIO または None
    """
    try:
        # 入力をPIL Imageに変換
        if isinstance(image_data, Image.Image):
            img = image_data.copy()
        elif isinstance(image_data, bytes):
            img = Image.open(BytesIO(image_data))
        elif isinstance(image_data, BytesIO):
            image_data.seek(0)
            img = Image.open(image_data)
        elif isinstance(image_data, str):
            img = Image.open(image_data)
        else:
            print(f"Unsupported type: {type(image_data)}")
            return False if output_path else None

        # 丼の縁ギリギリクロップ
        result = crop_bowl_tight(img)

        # 出力
        if output_path:
            result.save(output_path, format='JPEG', quality=95)
            return True
        else:
            output = BytesIO()
            result.save(output, format='JPEG', quality=95)
            output.seek(0)
            return output

    except Exception as e:
        print(f"Crop error: {e}")
        import traceback
        traceback.print_exc()
        return False if output_path else None


def crop_bowl_memory(image_bytes):
    """
    インメモリで丼クロップ（Vercel専用）

    Args:
        image_bytes: 画像のバイトデータ

    Returns:
        処理済み画像のbytes（JPEG形式） または None
    """
    try:
        result = crop_bowl(image_bytes)
        if result and isinstance(result, BytesIO):
            return result.getvalue()
        return None

    except Exception as e:
        print(f"Memory crop error: {e}")
        return None
