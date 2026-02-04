"""
画像処理モジュール - EXIF回転対応版
フロントで切り抜いた画像を保存 + EXIF回転を物理的に適用
"""
from PIL import Image, ExifTags
from io import BytesIO
import os


def apply_exif_rotation(img):
    """
    EXIF Orientationタグに基づいて画像を物理的に回転する
    Pixel 6a等で横向き撮影された画像を正しい向きに補正

    Args:
        img: PIL Image

    Returns:
        PIL Image（回転済み）
    """
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

        print(f"📐 EXIF Orientation検出: {orientation}")

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
            print(f"✅ EXIF回転を物理的に適用 → 正しい向きに補正完了")

        return img

    except Exception as e:
        print(f"⚠️ EXIF回転処理エラー（無視して続行）: {e}")
        return img


def save_simple(image_data, output_path):
    """
    画像保存（EXIF回転を適用してから保存）

    Args:
        image_data: PIL Image, bytes, BytesIO, またはファイルパス
        output_path: 保存先パス

    Returns:
        True/False
    """
    try:
        print("\n" + "=" * 70)
        print("💾 画像保存処理（EXIF回転対応）")
        print("=" * 70)

        # 入力を PIL Image に変換
        if isinstance(image_data, Image.Image):
            img = image_data.copy()
        elif isinstance(image_data, bytes):
            img = Image.open(BytesIO(image_data))
        elif isinstance(image_data, BytesIO):
            image_data.seek(0)
            img = Image.open(image_data)
        elif isinstance(image_data, str):
            if not os.path.exists(image_data):
                print(f"❌ 入力ファイルが見つかりません: {image_data}")
                return False
            img = Image.open(image_data)
        else:
            print(f"❌ 未対応の入力タイプ: {type(image_data)}")
            return False

        print(f"📸 画像読み込み完了: {img.size}, モード: {img.mode}")

        # EXIF回転を適用
        img = apply_exif_rotation(img)

        # RGB変換
        if img.mode != 'RGB':
            img = img.convert('RGB')

        # ディレクトリ確認・作成
        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)

        # 保存実行
        img.save(output_path, format='JPEG', quality=95)

        # 保存確認
        if os.path.exists(output_path):
            file_size = os.path.getsize(output_path)
            if file_size > 0:
                print(f"✅ 保存完了: {output_path} ({file_size} bytes)")
                print("=" * 70 + "\n")
                return True

        print("❌ 保存失敗")
        print("=" * 70 + "\n")
        return False

    except Exception as e:
        print(f"❌ エラー: {e}")
        import traceback
        traceback.print_exc()
        return False


def crop_bowl(image_data, output_path=None):
    """
    画像の保存（EXIF回転を適用）
    フロント側のCropper.jsで切り抜き済みの画像を受け取る前提
    """
    if output_path:
        return save_simple(image_data, output_path)
    else:
        try:
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
                return None

            img = apply_exif_rotation(img)

            if img.mode != 'RGB':
                img = img.convert('RGB')

            output = BytesIO()
            img.save(output, format='JPEG', quality=95)
            output.seek(0)
            return output
        except:
            return None
