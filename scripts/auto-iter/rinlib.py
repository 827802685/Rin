#!/usr/bin/env python3.11
"""
rinlib — GitHub REST API 封装（仅依赖 api.github.com，规避 github.com:443 被沙箱拦截）。
负责：拉取仓库树/Blob 到本地、管理 auto 分支、以单提交方式推送改动、合并 auto->main、读取状态。
所有远端写入都走 GitHub REST API（不依赖 git smart-HTTP），因此可在仅能访问 api.github.com 的环境运行。
"""
import os, sys, json, base64, time, urllib.request, urllib.error

TOKEN = os.environ.get('RIN_AUTO_TOKEN') or open('/root/rin-iteration/.token').read().strip()
OWNER = os.environ.get('RIN_OWNER', '827802685')
REPO = os.environ.get('RIN_REPO', 'Rin')
API = 'https://api.github.com'

# ---------- 低层 HTTP ----------
def _req(method, path, body=None, headers=None, retries=6):
    url = path if path.startswith('http') else f'{API}{path}'
    h = {
        'Authorization': f'Bearer {TOKEN}',
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'rin-auto-iter',
        'X-GitHub-Api-Version': '2022-11-28',
    }
    if headers:
        h.update(headers)
    if body is not None:
        data = json.dumps(body).encode()
        h['Content-Type'] = 'application/json'
    else:
        data = None
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, data=data, headers=h, method=method)
            with urllib.request.urlopen(req, timeout=60) as r:
                txt = r.read().decode('utf-8', 'replace')
                ctype = r.headers.get('Content-Type', '')
                if not txt:
                    return {}
                if 'application/json' in ctype:
                    return json.loads(txt) if txt else {}
                return txt
        except urllib.error.HTTPError as e:
            txt = e.read().decode('utf-8', 'replace')
            last = (e.code, txt)
            # 速率限制 / 次要错误可重试
            if e.code in (403, 429, 500, 502, 503):
                reset = e.headers.get('X-RateLimit-Reset')
                wait = 5 * attempt
                if e.code in (429, 403) and reset:
                    try:
                        wait = max(1, int(reset) - int(time.time()) + 1)
                    except Exception:
                        pass
                print(f'  [http {e.code}] retry {attempt}/{retries} after {wait}s: {txt[:120]}', file=sys.stderr)
                time.sleep(wait)
                continue
            raise
        except Exception as e:
            last = str(e)
            print(f'  [net err] retry {attempt}/{retries}: {e}', file=sys.stderr)
            time.sleep(3 * attempt)
            continue
    raise RuntimeError(f'API {method} {path} failed after {retries} retries: {last}')

def api_get(path, params=None):
    if params:
        q = '&'.join(f'{k}={urllib.parse.quote(str(v))}' for k, v in params.items())
        path += ('&' if '?' in path else '?') + q
    return _req('GET', path)

def api_post(path, body):
    return _req('POST', path, body)

def api_patch(path, body):
    return _req('PATCH', path, body)

# ---------- 分支/引用 ----------
def get_ref_sha(ref):
    """ref 形如 main / auto / heads/auto。返回 commit sha 或 None。"""
    for cand in [f'heads/{ref}', ref]:
        try:
            d = api_get(f'/repos/{OWNER}/{REPO}/git/refs/{cand}')
            if 'object' in d:
                return d['object']['sha']
        except Exception:
            pass
    return None

def list_branches():
    d = api_get(f'/repos/{OWNER}/{REPO}/branches?per_page=100')
    return [b['name'] for b in d] if isinstance(d, list) else []

def branch_exists(name):
    return get_ref_sha(name) is not None

def create_branch(name, from_sha):
    return api_post(f'/repos/{OWNER}/{REPO}/git/refs', {'ref': f'refs/heads/{name}', 'sha': from_sha})

def update_ref(name, sha, force=False):
    """更新 heads/<name> 到 sha。不存在则创建。"""
    try:
        return api_patch(f'/repos/{OWNER}/{REPO}/git/refs/heads/{name}', {'sha': sha, 'force': force})
    except urllib.error.HTTPError:
        return create_branch(name, sha)

def get_commit(sha):
    return api_get(f'/repos/{OWNER}/{REPO}/git/commits/{sha}')

def merge(head, base):
    """把 head 合并进 base（base 接收合并提交），返回 merge commit sha 或 None（已是最新/冲突/无操作）。"""
    try:
        d = api_post(f'/repos/{OWNER}/{REPO}/merges', {'base': base, 'head': head})
        if isinstance(d, dict):
            return d.get('sha')
        return None  # 空响应：已是最新/无操作
    except urllib.error.HTTPError as e:
        print(f'  [merge {head}->{base}] failed: {e.read().decode()[:200]}', file=sys.stderr)
        return None

# ---------- 树/Blob 拉取（本地工作副本） ----------
SKIP_DIRS = {'models', 'theme', 'node_modules', '.git', 'dist', '.turbo', '.live2d-engine', 'build', 'coverage', 'output', 'out'}
SKIP_EXT = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.woff', '.woff2', '.ttf', '.otf', '.ico', '.mov', '.avi', '.mkv', '.zip', '.gz', '.bin', '.pdf', '.psd', '.sketch'}

def should_skip(path, size):
    # 仅跳过「顶层」目录（避免误伤 client/src/components/theme 等真实源码）
    top = path.split('/')[0]
    if top in SKIP_DIRS:
        return True
    ext = os.path.splitext(path)[1].lower()
    if ext in SKIP_EXT:
        return True
    if size and size > 1_500_000:  # >1.5MB 视为大二进制/资产，跳过
        return True
    return False

def get_tree_sha(ref):
    d = api_get(f'/repos/{OWNER}/{REPO}/commits/{ref}')
    return d['commit']['tree']['sha']

def fetch_tree(tree_sha):
    d = api_get(f'/repos/{OWNER}/{REPO}/git/trees/{tree_sha}?recursive=1')
    return d.get('tree', [])

def fetch_blob(sha):
    d = api_get(f'/repos/{OWNER}/{REPO}/git/blobs/{sha}')
    enc = d.get('encoding', 'base64')
    if enc == 'base64':
        return base64.b64decode(d['content'])
    return d['content'].encode('utf-8')

def sync_local(ref, dest):
    """拉取 ref 的源码到 dest（跳过大二进制/资产）。返回 (file_count, skipped_count)。"""
    os.makedirs(dest, exist_ok=True)
    tree_sha = get_tree_sha(ref)
    tree = fetch_tree(tree_sha)
    fetched = 0
    skipped = 0
    for ent in tree:
        if ent['type'] != 'blob':
            continue
        path = ent['path']
        size = ent.get('size', 0)
        if should_skip(path, size):
            skipped += 1
            continue
        try:
            data = fetch_blob(ent['sha'])
        except Exception as e:
            print(f'  skip {path}: blob fetch failed {e}', file=sys.stderr)
            skipped += 1
            continue
        outp = os.path.join(dest, path)
        os.makedirs(os.path.dirname(outp), exist_ok=True)
        # 以二进制写入，保留文本/可能存在的二进制
        with open(outp, 'wb') as f:
            f.write(data)
        fetched += 1
    return fetched, skipped

# ---------- 提交（单提交，多文件） ----------
def put_commit(ref, changes, message):
    """
    changes: dict[path] = new_content(str)
    在 ref 当前 HEAD 之上创建一个新提交（单个提交含所有改动），更新 ref。
    返回新 commit sha。
    """
    base_sha = get_ref_sha(ref)
    if base_sha is None:
        raise RuntimeError(f'ref {ref} 不存在，无法在其上提交')
    base_tree_sha = get_commit(base_sha)['tree']['sha']
    entries = []
    for path, content in changes.items():
        blob = api_post(f'/repos/{OWNER}/{REPO}/git/blobs',
                        {'content': content if isinstance(content, str) else content.decode('utf-8'),
                         'encoding': 'utf-8'})
        entries.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    new_tree = api_post(f'/repos/{OWNER}/{REPO}/git/trees',
                        {'base_tree': base_tree_sha, 'tree': entries})
    new_commit = api_post(f'/repos/{OWNER}/{REPO}/git/commits',
                          {'message': message, 'tree': new_tree['sha'], 'parents': [base_sha]})
    update_ref(ref, new_commit['sha'])
    return new_commit['sha']

def read_file(ref, path):
    d = api_get(f'/repos/{OWNER}/{REPO}/contents/{path}?ref={ref}')
    if 'content' not in d:
        return None
    return base64.b64decode(d['content']).decode('utf-8', 'replace')

if __name__ == '__main__':
    print('branches:', list_branches())
    print('main sha:', get_ref_sha('main'))
