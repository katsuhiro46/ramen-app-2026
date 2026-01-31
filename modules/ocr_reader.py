"""
OCR（光学文字認識）モジュール - Mac mini M4対応
看板・メニューから店名を抽出
"""
import re
from typing import Optional
from PIL import Image

# Mac mini M4 の Homebrew Tesseract パス
TESSERACT_PATH = '/opt/homebrew/bin/tesseract'

# pytesseractの設定
try:
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH
    OCR_AVAILABLE = True
    print(f"Tesseract configured: {TESSERACT_PATH}")
except ImportError:
    OCR_AVAILABLE = False
    print("Warning: pytesseract not installed. OCR features disabled.")


def extract_text_from_image(image_path: str) -> Optional[str]:
    """
    画像からテキストを抽出（日本語OCR）
    """
    if not OCR_AVAILABLE:
        print("OCR not available")
        return None
    
    try:
        print(f"Running OCR on: {image_path}")
        
        image = Image.open(image_path)
        
        # 画像を前処理（コントラスト向上）
        # image = image.convert('L')  # グレースケール
        
        # 日本語+英語でOCR
        text = pytesseract.image_to_string(image, lang='jpn+eng')
        
        if text:
            print(f"OCR result (first 100 chars): {text[:100]}")
        else:
            print("OCR returned empty result")
        
        return text.strip() if text else None
        
    except Exception as e:
        print(f"OCR error: {e}")
        return None


def find_shop_name_in_text(text: str) -> Optional[str]:
    """
    OCR結果から店名候補を抽出
    """
    if not text:
        return None
    
    lines = text.split('\n')
    candidates = []
    
    # ラーメン関連キーワード
    ramen_keywords = [
        'らーめん', 'ラーメン', 'らぁめん', 'ラァメン',
        '拉麺', '中華そば', '中華麺', 'つけ麺', 'つけめん',
        '麺屋', '麺処', '麺家', '麺道', '麺や',
        'らー麺', '担々麺', '味噌', '醤油', '塩', '豚骨',
    ]
    
    for line in lines:
        line = line.strip()
        if not line or len(line) < 2:
            continue
        
        # ラーメン関連キーワードを含む行を優先
        for keyword in ramen_keywords:
            if keyword in line:
                print(f"Ramen keyword '{keyword}' found in: {line}")
                candidates.insert(0, line)
                break
        else:
            # 店名っぽい長さ（短すぎず長すぎない）
            if 3 <= len(line) <= 25:
                # 数字だけの行は除外
                if not re.match(r'^[\d\.\-\s]+$', line):
                    candidates.append(line)
    
    if candidates:
        result = clean_ocr_name(candidates[0])
        print(f"OCR shop name candidate: {result}")
        return result
    
    return None


def clean_ocr_name(text: str) -> str:
    """OCR結果をクリーニング"""
    if not text:
        return ""
    
    # 不要な文字を削除
    text = re.sub(r'[【】「」『』\[\]\(\)（）〈〉《》]', '', text)
    text = re.sub(r'[\d\.\,\:\;]+', ' ', text)
    text = re.sub(r'[!！?？]+', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text


def find_shop_name_from_image(image_path: str) -> Optional[str]:
    """
    画像から店名を抽出するメイン関数
    """
    print(f"=== OCR Shop Finder: {image_path} ===")
    
    text = extract_text_from_image(image_path)
    if text:
        result = find_shop_name_in_text(text)
        if result:
            print(f"=== OCR Result: {result} ===")
            return result
    
    print("OCR could not extract shop name")
    return None
