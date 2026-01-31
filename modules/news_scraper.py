"""
ラーメンデータベース スクレイパー - 決定版
精密清掃 + 県別カラー対応
"""
import requests
from bs4 import BeautifulSoup
import re
from typing import List, Dict, Tuple
import time


# 表示順: 群馬 → 栃木 → 埼玉 → 茨城
URLS = [
    ('https://ramendb.supleks.jp/search?state=gunma&order=open-date', '群馬'),
    ('https://ramendb.supleks.jp/search?state=tochigi&order=open-date', '栃木'),
    ('https://ramendb.supleks.jp/search?state=saitama&order=open-date', '埼玉'),
    ('https://ramendb.supleks.jp/search?state=ibaraki&order=open-date', '茨城'),
]

SHOPS_PER_PREFECTURE = 10

# 削除対象キーワード（完全一致で削除）
GARBAGE_KEYWORDS = [
    # 数字系（正規表現で処理）
    # ステータス
    'ニューオープン', 'ニュー', '新店', 'NEW', 'OPEN', 'オープン',
    '移転', '閉店', '休業',
    # 設備
    '駐車場あり', '駐車場', 'Pあり',
    '禁煙', '完全禁煙', '喫煙可',
    'ベビーカー可', '子供イス',
    'テイクアウト', 'Wi-Fi',
    # ジャンル
    '二郎系', '家系', '無化調', '自家製麺',
    # 広告
    'PR', 'AD', '広告',
]


def clean_shop_name(raw_text: str) -> str:
    """
    店名の精密清掃
    1. <a>タグから取得したテキストを入力
    2. 末尾のゴミを削除
    3. 住所部分をカット（都道府県・郡・市区町村）
    """
    if not raw_text:
        return ""
    
    text = raw_text.strip()
    
    # ========================================
    # Step 1: 数字+単位パターンを削除
    # ========================================
    text = re.sub(r'\d+\.?\d*\s*ポイント', '', text)
    text = re.sub(r'\d+\s*レビュー', '', text)
    text = re.sub(r'\d+\s*スキ', '', text)
    text = re.sub(r'\d+\s*フォト', '', text)
    text = re.sub(r'\d+\s*件', '', text)
    
    # ========================================
    # Step 2: ゴミキーワードを削除
    # ========================================
    for keyword in GARBAGE_KEYWORDS:
        text = text.replace(keyword, ' ')
    
    # ========================================
    # Step 3: 都道府県名以降をカット（住所全体を削除）
    # ========================================
    prefectures = ['埼玉県', '群馬県', '栃木県', '茨城県', '茨城县', '千葉県', '東京都', '神奈川県']
    for pref in prefectures:
        if pref in text:
            idx = text.find(pref)
            text = text[:idx]
    
    # ========================================
    # Step 3.5: 郡+町/村パターンを削除
    #           例: 比企郡武蔵嵐山町、邑楽郡大泉町
    # ========================================
    text = re.sub(r'[^\s]{1,5}郡[^\s]{1,8}[町村]', '', text)
    
    # ========================================
    # Step 3.6: 市区町村パターンを削除
    #           例: 新座市、草加市（スペースで区切られている場合）
    # ========================================
    text = re.sub(r'\s+[^\s]{1,6}[市区町村]\s*', ' ', text)
    text = re.sub(r'\s+[^\s]{1,6}[市区町村]$', '', text)
    
    # ========================================
    # Step 4: 括弧を削除
    # ========================================
    text = re.sub(r'【[^】]*】', '', text)
    text = re.sub(r'（[^）]*）', '', text)
    text = re.sub(r'\([^)]*\)', '', text)
    
    # ========================================
    # Step 5: 日付を削除
    # ========================================
    text = re.sub(r'\d{1,2}月\d{1,2}日', '', text)
    text = re.sub(r'\d{4}/\d{1,2}/\d{1,2}', '', text)
    
    # ========================================
    # Step 6: 末尾の孤立したゴミを削除
    # ========================================
    text = re.sub(r'\s+\d+\.?\d*\s*$', '', text)
    
    # ========================================
    # Step 7: 最終クリーンアップ
    # ========================================
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'^[\s\-・、。/\|:：\.]+', '', text)
    text = re.sub(r'[\s\-・、。/\|:：\.]+$', '', text)
    
    return text


def extract_city_name(info_text: str) -> str:
    """
    地名抽出（シンプル・確実版）
    
    ルール:
    1. 郡がある → ◯◯郡 まで抽出（町村はカット）
    2. 郡がない → ◯◯市 を抽出
    
    実用性重視：空欄になるより確実に表示させる
    """
    if not info_text:
        return ""
    
    # 優先1: ◯◯郡 パターン（郡があれば郡までで止める）
    # 例: 比企郡武蔵嵐山町 → 比企郡
    match = re.search(r'([^\s]{1,5}郡)', info_text)
    if match:
        return match.group(1)
    
    # 優先2: ◯◯市 パターン
    # 例: 新座市、さいたま市、ひたちなか市
    match = re.search(r'([^\s]{1,10}市)', info_text)
    if match:
        return match.group(1)
    
    # 優先3: ◯◯区 パターン（東京23区など）
    match = re.search(r'([^\s]{1,10}区)', info_text)
    if match:
        return match.group(1)
    
    return ""


def extract_open_date(info_text: str) -> str:
    """オープン日を抽出"""
    if not info_text:
        return ""
    
    match = re.search(r'(\d{4}/\d{1,2}/\d{1,2})', info_text)
    if match:
        return match.group(1)
    
    match = re.search(r'(\d{1,2}月\d{1,2}日)', info_text)
    if match:
        return match.group(1)
    
    return ""


def is_pr_item(element) -> bool:
    """PR判定"""
    classes = element.get('class', [])
    if any('pr' in str(c).lower() for c in classes):
        return True
    parent = element.find_parent(['li', 'div'])
    if parent and any('pr' in str(c).lower() for c in parent.get('class', [])):
        return True
    return False


def scrape_one_prefecture(url: str, pref_name: str, session) -> List[Dict]:
    """1県分をスクレイピング"""
    shops = []
    
    try:
        response = session.get(url, timeout=15)
        response.raise_for_status()
        response.encoding = 'utf-8'
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 店舗リンクを取得（<a href="/s/数字.html">）
        links = soup.find_all('a', href=re.compile(r'^/s/\d+\.html$'))
        
        seen = set()
        count = 0
        
        for link in links:
            if is_pr_item(link):
                continue
            
            href = link.get('href', '')
            if href in seen:
                continue
            seen.add(href)
            
            # <a>タグの中身だけを取得
            raw_name = link.get_text(strip=True)
            shop_name = clean_shop_name(raw_name)
            
            if not shop_name or len(shop_name) < 2:
                continue
            
            count += 1
            
            city_name = ""
            open_date = ""
            
            parent = link.find_parent('li') or link.find_parent('div')
            if parent:
                info_el = parent.find(class_='info')
                if info_el:
                    info_text = info_el.get_text(' ', strip=True)
                    city_name = extract_city_name(info_text)
                    open_date = extract_open_date(info_text)
            
            shops.append({
                'name': shop_name,
                'area': pref_name,
                'url': f"https://ramendb.supleks.jp{href}",
                'city': city_name,
                'open_date': open_date,
            })
            
            if count >= SHOPS_PER_PREFECTURE:
                break
        
        return shops
        
    except Exception as e:
        print(f"Error: {pref_name}: {e}")
        return []


def get_new_reviews() -> Tuple[List[Dict], str]:
    """メインエントリーポイント"""
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    })
    
    all_shops = []
    logs = []
    
    for url, pref_name in URLS:
        shops = scrape_one_prefecture(url, pref_name, session)
        all_shops.extend(shops)
        logs.append(f"{pref_name}: {len(shops)}件")
        time.sleep(1)
    
    return all_shops, " | ".join(logs)
