import os
import sys
import time

# Add parent directory to path for module imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from modules import gps_locator, cropper, labeler, news_scraper
from modules import gps_shop_finder, ocr_reader

# Get parent directory for templates and static files
PARENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

app = Flask(__name__, 
            template_folder=os.path.join(PARENT_DIR, 'templates'),
            static_folder=os.path.join(PARENT_DIR, 'static'))

# Configuration - Vercel uses /tmp for temporary files
VERCEL_TMP_BASE = '/tmp'
app.config['UPLOAD_FOLDER'] = os.path.join(VERCEL_TMP_BASE, 'ramen_in')
app.config['OUTPUT_FOLDER'] = os.path.join(VERCEL_TMP_BASE, 'ramen_out')

# Ensure directories exist
try:
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    os.makedirs(app.config['OUTPUT_FOLDER'], exist_ok=True)
except OSError as e:
    print(f"Warning: Could not create directories at {VERCEL_TMP_BASE}. Error: {e}")

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/analyze', methods=['POST'])
def analyze():
    """
    全自動分析エンドポイント
    1. GPS座標から周辺ラーメン店を検索
    2. OCRで看板文字を認識
    3. 最適な店名を自動選択
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        unique_filename = f"{int(time.time())}_{filename}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
        
        # EXIFメタデータを保持するため、バイナリで直接書き込み
        file_data = file.read()
        with open(filepath, 'wb') as f:
            f.write(file_data)
        
        print(f"✅ File saved: {filepath} ({len(file_data)} bytes)")

        shop_name = None
        detection_method = "manual"
        debug_info = ""
        gps_detected = False
        gps_lat = None
        gps_lon = None
        shop_distance = None
        candidates = []  # 候補リスト

        
        # ========================================
        # Step 1: OCRで看板文字を取得
        # ========================================
        ocr_text = None
        try:
            ocr_text = ocr_reader.extract_text_from_image(filepath)
            print(f"OCR: {ocr_text[:80] if ocr_text else 'なし'}...")
        except Exception as e:
            print(f"OCR error: {e}")
        
        # ========================================
        # Step 2: GPS座標を取得
        # ========================================
        try:
            gps = gps_locator.get_gps_coordinates(filepath)
            if gps:
                gps_lat, gps_lon = gps
                gps_detected = True
                print(f"✅ GPS: {gps_lat:.6f}, {gps_lon:.6f}")
                
                # GPS＋OCRハイブリッド検索
                result = gps_shop_finder.find_shop_by_gps(gps_lat, gps_lon, ocr_text)
                
                # 結果を取得（店舗が見つかったかどうかに関わらず）
                if result:
                    shop_name = result.get('shop_name')  # Noneの可能性あり
                    detection_method = result.get('method', 'gps')
                    debug_info = result.get('debug_info', f"GPS: {gps_lat:.6f}, {gps_lon:.6f}")
                    shop_distance = result.get('distance')
                    candidates = result.get('candidates', [])

            else:
                print("❌ GPS未検出")
                debug_info = "GPS未検出（EXIFなし）"
                
        except Exception as e:
            print(f"GPS error: {e}")
            debug_info = f"GPS取得エラー: {str(e)[:30]}"
        
        # ========================================
        # Step 3: GPSなしの場合はOCRフォールバック
        # ========================================
        if not shop_name and not gps_detected:
            try:
                result = gps_shop_finder.find_shop_without_gps(ocr_text)
                if result and result.get('shop_name'):
                    shop_name = result['shop_name']
                    detection_method = 'ocr_fallback'
                    debug_info = result.get('debug_info', '')
            except Exception as e:
                print(f"OCR fallback error: {e}")
        
        # ========================================
        # Step 4: OCR直接抽出（最後の手段）
        # ========================================
        if not shop_name and ocr_text:
            try:
                ocr_name = ocr_reader.find_shop_name_in_text(ocr_text)
                if ocr_name:
                    shop_name = ocr_name
                    detection_method = "ocr_direct"
                    debug_info += f" | OCR直接: {ocr_name}"
            except Exception as e:
                print(f"OCR direct error: {e}")
        
        # デフォルト値（ラーメン店が見つからない場合）
        if not shop_name:
            shop_name = "店舗名：判定不能"
            detection_method = "not_found"
            if not debug_info:
                debug_info = "周辺にラーメン店が見つかりませんでした"


        # 候補リストをシンプルな形式に変換
        candidates_simple = []
        for c in candidates[:3]:
            candidates_simple.append({
                'name': c.get('name', ''),
                'distance': c.get('distance', 0)
            })

        # ========================================
        # Step 5: クロップ処理を実行
        # ========================================
        cropped_filename = f"cropped_{unique_filename}"
        cropped_path = os.path.join(app.config['OUTPUT_FOLDER'], cropped_filename)
        
        crop_success = cropper.crop_bowl(filepath, cropped_path)
        
        if crop_success:
            # クロップ成功 → クロップ済み画像を返す
            image_url = f'/results/{cropped_filename}'
            print(f"✅ Crop success: {cropped_path}")
        else:
            # クロップ失敗 → 元画像を返す（フォールバック）
            image_url = f'/uploads/{unique_filename}'
            print(f"⚠️ Crop failed, using original image")

        return jsonify({
            'filename': unique_filename,
            'cropped_filename': cropped_filename if crop_success else None,
            'shop_name': shop_name,
            'detection_method': detection_method,
            'image_url': image_url,
            'crop_success': crop_success,
            'debug': {
                'gps_detected': gps_detected,
                'lat': gps_lat,
                'lon': gps_lon,
                'distance': shop_distance,
                'ocr_text': ocr_text[:200] if ocr_text else None,
                'candidates': candidates_simple,
                'info': debug_info
            }
        })





    return jsonify({'error': 'Invalid file type'}), 400


@app.route('/process', methods=['POST'])
def process():
    """店名ラベル追加エンドポイント（クロップ済み画像を使用）"""
    data = request.json
    filename = data.get('filename')
    shop_name = data.get('shop_name')
    
    if not filename or not shop_name:
        return jsonify({'error': 'Missing data'}), 400
    
    # クロップ済み画像のパスを確認
    cropped_filename = f"cropped_{filename}"
    cropped_path = os.path.join(app.config['OUTPUT_FOLDER'], cropped_filename)
    
    # 最終出力ファイル名
    output_filename = f"labeled_{filename}"
    output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
    
    # クロップ済み画像が存在するか確認
    if os.path.exists(cropped_path):
        # クロップ済み画像をコピーしてラベル追加
        import shutil
        shutil.copy(cropped_path, output_path)
        print(f"✅ Using cropped image: {cropped_path}")
    else:
        # クロップ済み画像がない場合は元画像からクロップ
        input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if not cropper.crop_bowl(input_path, output_path):
            # クロップ失敗時は元画像をコピー
            import shutil
            shutil.copy(input_path, output_path)
            print(f"⚠️ Crop failed, using original image")
        else:
            print(f"✅ Cropped on demand: {output_path}")

    # ラベル追加
    if not labeler.add_label(output_path, shop_name):
        return jsonify({'error': '文字入れに失敗しました'}), 500

    print(f"✅ Label added: {shop_name}")

    return jsonify({
        'result_url': f'/results/{output_filename}'
    })



@app.route('/auto-process', methods=['POST'])
def auto_process():
    """
    完全自動処理エンドポイント
    写真アップロード → 店名検出 → クロップ → ラベル付け → 完了
    手作業ゼロ
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file and allowed_file(file.filename):
        # ファイル保存（EXIFメタデータ保持）
        filename = secure_filename(file.filename)
        unique_filename = f"{int(time.time())}_{filename}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
        
        file_data = file.read()
        with open(filepath, 'wb') as f:
            f.write(file_data)
        
        print(f"✅ Auto-process file saved: {filepath} ({len(file_data)} bytes)")

        # Step 1: 店名自動検出
        shop_name = None
        debug_info = ""
        
        # OCRテキスト取得
        ocr_text = None
        try:
            ocr_text = ocr_reader.extract_text_from_image(filepath)
        except:
            pass
        
        # デバッグ情報を保持
        gps_lat = None
        gps_lon = None
        gps_detected = False
        candidates = []
        shop_distance = None
        debug_info = ""
        
        # GPS検索
        try:
            gps = gps_locator.get_gps_coordinates(filepath)
            if gps:
                gps_lat, gps_lon = gps
                gps_detected = True
                print(f"✅ Auto-process GPS: {gps_lat}, {gps_lon}")
                
                result = gps_shop_finder.find_shop_by_gps(gps_lat, gps_lon, ocr_text)
                if result and isinstance(result, dict):
                    shop_name = result.get('shop_name')
                    debug_info = result.get('debug_info', '')
                    candidates = result.get('candidates', [])
                    shop_distance = result.get('distance')
                elif result and isinstance(result, str):
                    shop_name = result
            else:
                debug_info = "GPS未検出（EXIFなし）"
        except Exception as e:
            print(f"Auto-process GPS error: {e}")
            debug_info = f"GPS取得エラー: {str(e)[:30]}"
        
        # OCRフォールバック
        if not shop_name:
            try:
                shop_name = ocr_reader.find_shop_name_from_image(filepath)
            except Exception as e:
                print(f"Auto-process OCR error: {e}")
        
        if not shop_name:
            shop_name = "店舗名：判定不能"

        # 候補リストをシンプルな形式に変換
        candidates_simple = []
        for c in candidates[:3]:
            candidates_simple.append({
                'name': c.get('name', ''),
                'distance': c.get('distance', 0)
            })

        # Step 2: クロップ
        output_filename = f"processed_{unique_filename}"
        output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
        
        crop_success = cropper.crop_bowl(filepath, output_path)
        if not crop_success:
            import shutil
            shutil.copy(filepath, output_path)

        # Step 3: ラベル付け
        labeler.add_label(output_path, shop_name)

        return jsonify({
            'success': True,
            'shop_name': shop_name,
            'result_url': f'/results/{output_filename}',
            'debug': {
                'gps_detected': gps_detected,
                'lat': gps_lat,
                'lon': gps_lon,
                'distance': shop_distance,
                'ocr_text': ocr_text[:200] if ocr_text else None,
                'candidates': candidates_simple,
                'info': debug_info
            }
        })


    return jsonify({'error': 'Invalid file type'}), 400


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/reprocess', methods=['POST'])
def reprocess():
    """店名を修正して画像を再加工"""
    try:
        data = request.get_json()
        filename = data.get('filename')
        new_shop_name = data.get('shop_name')
        
        if not filename or not new_shop_name:
            return jsonify({'error': 'Missing filename or shop_name'}), 400
        
        # 元画像のパス
        input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        if not os.path.exists(input_path):
            return jsonify({'error': 'Original file not found'}), 404
        
        # 出力パス
        output_filename = f"processed_{filename}"
        output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
        
        # クロップ
        crop_success = cropper.crop_bowl(input_path, output_path)
        if not crop_success:
            # クロップ失敗時は元画像をコピー
            import shutil
            shutil.copy(input_path, output_path)
        
        # 新しい店名でラベル付け
        labeler.add_label(output_path, new_shop_name)
        
        print(f"✅ Reprocessed with new name: {new_shop_name}")
        
        return jsonify({
            'success': True,
            'shop_name': new_shop_name,
            'result_url': f'/results/{output_filename}'
        })
        
    except Exception as e:
        print(f"Reprocess error: {e}")
        return jsonify({'error': str(e)}), 500



@app.route('/results/<filename>')
def result_file(filename):
    return send_from_directory(app.config['OUTPUT_FOLDER'], filename)


@app.route('/api/news')
def get_news():
    try:
        news_data, log_msg = news_scraper.get_new_reviews()
        return jsonify({
            "status": "success",
            "shops": news_data,
            "log": log_msg
        })
    except Exception as e:
        print(f"Scraper Error: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=3000)

