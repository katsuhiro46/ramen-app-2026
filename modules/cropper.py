"""
画像処理モジュール - 超軽量版
AI計算ゼロ、ただの切り取り職人
フロントで決めた通りに切り抜くだけ
"""
from PIL import Image
from io import BytesIO
import os


def save_simple(image_data, output_path):
    """
    超シンプル保存（AI計算なし）
    フロントで調整済みの画像をそのまま保存するだけ

    Args:
        image_data: PIL Image, bytes, BytesIO, またはファイルパス
        output_path: 保存先パス

    Returns:
        True/False
    """
    try:
        print("\n" + "="*70)
        print("💾 SIMPLE SAVE (No AI, Just Save)")
        print("="*70)

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
                print(f"❌ Input file not found: {image_data}")
                return False
            img = Image.open(image_data)
        else:
            print(f"❌ Unsupported type: {type(image_data)}")
            return False

        print(f"✅ Image loaded: {img.size}, {img.mode}")

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
                print(f"✅ SAVED: {output_path} ({file_size} bytes)")
                print("="*70 + "\n")
                return True

        print(f"❌ Save failed")
        print("="*70 + "\n")
        return False

    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


# 旧関数との互換性のため残す（将来削除予定）
def crop_bowl(image_data, output_path=None):
    """
    互換性のための関数（非推奨）
    新しいコードでは save_simple を使用してください
    """
    if output_path:
        return save_simple(image_data, output_path)
    else:
        # BytesIO返却
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

            if img.mode != 'RGB':
                img = img.convert('RGB')

            output = BytesIO()
            img.save(output, format='JPEG', quality=95)
            output.seek(0)
            return output
        except:
            return None
