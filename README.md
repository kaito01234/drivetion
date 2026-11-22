# drivetion — Google ドライブに保存する Markdown メモ

PC と iPhone のブラウザから、Google ドライブ上の同じ Markdown ファイルを編集する個人用メモアプリです。

- バックエンドはありません。ブラウザから Google Drive API v3 を直接呼び出します。
- データの保存先は **Google ドライブだけ** です。Cloudflare(Workers の静的ファイル配信)は静的ファイルを配信するだけで、サーバー側のコードや KV・D1・R2 などは使いません。
- 未保存の内容は、再ログイン中やオフライン時に備えて **その端末のブラウザ内(IndexedDB)** に一時保存します。保存に成功したら削除します。

## 機能

| 機能 | 内容 |
|---|---|
| ログイン | Google Identity Services のトークンモデル(`google.accounts.oauth2.initTokenClient`) |
| 保存先フォルダ | 初回にアプリでフォルダを作成します。目印(`appProperties`)を付けるので、ほかの端末からログインしても同じフォルダが自動で使われます |
| ファイル操作 | `.md` ファイルの一覧、新規作成、名前変更、削除(ゴミ箱へ移動) |
| 編集 | Milkdown(WYSIWYG)。入力が止まってから 2 秒後に自動保存します |
| 保存状態の表示 | 変更なし、未保存の変更、保存中、保存済み、保存エラー(再試行ボタン付き)、再ログイン待ち、競合 |
| 他の端末の更新の取り込み | 画面に戻ったとき・オンラインに戻ったとき・表示中は 30 秒ごとに Drive 上の更新を確認し、未保存の変更がなければ最新の内容をそのまま反映します |
| 自動マージと競合検知 | 保存の直前に `version` と `md5Checksum` を確認します。他の端末で更新されていれば行単位の 3-way マージで両方の変更を合成し、同じ箇所を両方で変更していたときだけ「再読み込み」か「上書き」を選ぶダイアログを出します |
| チェックリスト | `- [ ]` / `- [x]` のチェックボックスをタップ・クリックで ON/OFF できます。ツールバーの ☑ で行をチェックリストにできます(行頭で `[ ] ` と入力しても作れます) |
| レイアウト | 幅 768px 以上では一覧とエディタを 2 列で表示します。それ未満(iPhone)では画面を切り替え、ブラウザの「戻る」とも連動します |
| トークン失効 | API が 401 を返したら、トークンを取り直して同じリクエストをやり直します。PC では自動でポップアップを試し、ホーム画面アプリでは「再ログイン」ボタンを出します |
| PWA | manifest と service worker(アプリ本体だけキャッシュ)。新しい版を配信すると「更新」ボタンを表示します |

## 技術構成と選定理由

- **Vite + TypeScript + React 19**
  - Milkdown に公式の React 連携(`@milkdown/react`)があります。
  - Preact に替えても約 40KB しか減らず、エディタ本体(約 140KB gzip)の方がずっと大きいので、React のままにしています。
  - エディタは遅延読み込みにして、一覧を先に表示できるようにしています。
- **エディタは Milkdown を採用**(Tiptap と比較)
  - Milkdown は remark を使って Markdown を直接読み込み・書き出しします。Tiptap は内部形式が JSON/HTML で、Markdown は変換層を通します。
  - Drive 上の `.md` ファイルが唯一の正本なので、書き出しの忠実さを優先しました。
  - Milkdown は読み込み時に書式を整え直すことがあります(例: 空行の数や、強調の記号 `*` / `_` がそろえられる)。そのため **利用者が操作するまでは保存しません**(開いただけではファイルは書き換わりません)。
- **スコープは `drive.file`**
  - アプリが作成したファイルとフォルダだけにアクセスできる最小限の権限です。
  - そのため **Drive の Web 画面などから直接アップロードした `.md` ファイルは一覧に出ません**。

## ディレクトリ構成

```
src/
├─ auth/       config.ts(スコープ・判定) gis.ts(GIS ラッパー) session.ts(認証状態・401 時の待機と再取得)
│              tokenStore.ts(トークン保持) redirect.ts(リダイレクト方式の代替ログイン)
├─ drive/      client.ts(fetch・401 再試行・バックオフ) files.ts(ファイル操作) folder.ts(フォルダの検出と作成)
├─ sync/       autosave.ts(デバウンス保存・更新の取り込み・競合検知) merge.ts(3-way マージ) drafts.ts(IndexedDB の下書き)
├─ editor/     MilkdownEditor.tsx  taskToggle.ts(チェックボックスの ON/OFF)
├─ components/ 画面部品(一覧・エディタ・ダイアログ・バナー)
└─ state/      小さなユーティリティ
e2e/           Google をモックした E2E テスト
public/        アイコン, _headers(レスポンスヘッダーの設定)
wrangler.jsonc Cloudflare Workers の設定(dist を静的ファイルとして配信)
```

---

## 1. Google Cloud の設定

### 1-1. プロジェクトを作成する
1. <https://console.cloud.google.com/> を開きます。
2. 画面上部のプロジェクト選択 →「新しいプロジェクト」を選びます。
3. 名前(例: `drivetion`)を入力して作成し、作成したプロジェクトを選択します。

### 1-2. Google Drive API を有効にする
1. 「API とサービス」→「ライブラリ」を開きます。
2. 「Google Drive API」を検索し、「有効にする」を押します。

### 1-3. OAuth 同意画面を設定する(テスト状態)
新しいコンソールでは「Google Auth Platform」という名前で表示されます。

1. 「API とサービス」→「OAuth 同意画面」(または「Google Auth Platform」→「概要」→「開始」)を開きます。
2. アプリ情報: アプリ名(例: `drivetion`)、ユーザーサポートメール(自分のアドレス)を入力します。
3. 対象(User Type): **外部** を選びます。Google Workspace 組織内だけで使う場合は「内部」でもかまいません。「内部」ならテストユーザーの登録は不要です。
4. 連絡先情報: 自分のメールアドレスを入力し、作成します。
5. 「データアクセス」(スコープ)→「スコープを追加または削除」で、次のスコープを追加して保存します。
   - `https://www.googleapis.com/auth/drive.file`
6. 「対象」(Audience)で、公開ステータスが **テスト** のままになっていることを確認します(「アプリを公開」は押しません)。
7. 同じ画面の「テストユーザー」→「ADD USERS」で、**自分の Google アカウント** を追加します。

> テスト状態では、ログイン時に「Google はこのアプリを確認していません」と表示されます。自分で作ったアプリなので「続行」を押してください。
> このアプリはリフレッシュトークンを使わないので、テスト状態の「リフレッシュトークンは 7 日で失効する」制限の影響は受けません。

### 1-4. OAuth クライアント ID を作成する
1. 「API とサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」を選びます(または「Google Auth Platform」→「クライアント」→「クライアントを作成」)。
2. アプリケーションの種類: **ウェブ アプリケーション** を選びます。
3. 名前: 任意(例: `drivetion-web`)。
4. **承認済みの JavaScript 生成元** に、次のセクションの URL を登録します。
5. 作成すると表示される **クライアント ID**(`xxxx.apps.googleusercontent.com`)を控えます。
   - クライアントシークレットは使いません。
   - クライアント ID はブラウザに埋め込まれる公開情報で、秘密ではありません。

### 1-5. 承認済みの JavaScript 生成元に登録する URL

| 用途 | URL |
|---|---|
| ローカル開発(`npm run dev`) | `http://localhost:5173` |
| ローカルでの本番ビルド確認(`npm run preview`) | `http://localhost:4173` |
| Cloudflare Workers(本番) | `https://drivetion.<アカウントのサブドメイン>.workers.dev` |
| 独自ドメインを使う場合 | `https://memo.example.com` など |

- 末尾の `/` やパスは付けません(生成元はスキーム + ホスト + ポートです)。
- ワイルドカードは使えません。本番以外のブランチのプレビュー URL は毎回変わるので、ログインは本番 URL で行ってください。
- アカウントのサブドメイン(`<アカウントのサブドメイン>` の部分)は、Cloudflare ダッシュボードの「Workers & Pages」の画面や、デプロイ完了時の表示で確認できます。
- 設定が反映されるまで数分かかることがあります。

### 1-6.(任意)リダイレクト方式を使う場合
iPhone のホーム画面アプリで、ログインのポップアップから戻ってこない場合の代替手段です(後述の「iPhone で使う」を参照)。`VITE_AUTH_MODE=auto` または `redirect` にする場合は、同じクライアントの **承認済みのリダイレクト URI** に、末尾 `/` 付きの URL を登録します。

- `http://localhost:5173/`
- `https://drivetion.<アカウントのサブドメイン>.workers.dev/`

---

## 2. ローカルで動かす

Node.js 20 以上(22 を推奨)が必要です。

```bash
npm install
```

```bash
cp .env.example .env.local
```

`.env.local` の `VITE_GOOGLE_CLIENT_ID` に、控えたクライアント ID を書きます。

```bash
npm run dev
```

<http://localhost:5173> を開きます。本番ビルドの確認(service worker も有効になります)は次のとおりです。

```bash
npm run build
```

```bash
npm run preview
```

<http://localhost:4173> で確認できます。

### 環境変数

| 変数 | 必須 | 内容 |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | ○ | OAuth クライアント ID |
| `VITE_AUTH_MODE` | | `popup`(既定、GIS のトークンモデル)/ `auto`(ホーム画面アプリのときだけリダイレクト方式)/ `redirect`(常にリダイレクト方式) |

`VITE_` で始まる変数は **ビルド時にコードへ埋め込まれます**。値を変えたらビルドし直し(再デプロイ)が必要です。

---

## 3. Cloudflare Workers へのデプロイ

Cloudflare Workers の静的ファイル配信(Static Assets)を使います。`wrangler.jsonc` で `dist` を配信する設定だけをしていて、**サーバー側のコードはありません**。

> Cloudflare は新しいプロジェクトには Pages ではなく Workers を勧めています(作成画面で Pages は「レガシー」と表示されます)。

### 方法 A: GitHub 連携(Workers Builds、おすすめ)
1. Cloudflare ダッシュボード →「**Workers & Pages**」→「**Create application**(アプリケーションを作成)」を開きます。
2. 「**Import a repository**(リポジトリをインポート)」→ GitHub と連携し、このリポジトリを選びます。
   - GitHub 側では「Only select repositories」でこのリポジトリだけを許可すれば十分です。
3. ビルド設定を次のようにします。

   | 項目 | 設定値 |
   |---|---|
   | Project name(プロジェクト名) | `drivetion`(**`wrangler.jsonc` の `name` と一致させる**。違うとビルドが失敗します) |
   | Build command(ビルドコマンド) | `npm run build` |
   | Deploy command(デプロイコマンド) | `npx wrangler deploy` |
   | Non-production branch deploy command(本番以外のブランチ) | `npx wrangler versions upload`(既定のまま) |
   | Path(ルートディレクトリ) | `/`(既定のまま) |

4. 「**Advanced settings**(詳細設定)」→「**Build variables**(ビルド変数)」に次を追加します。
   - `VITE_GOOGLE_CLIENT_ID` = クライアント ID
   - `NODE_VERSION` = `22`(ビルド環境の Node.js を固定します)
   - 必要なら `VITE_AUTH_MODE`
5. 「**Deploy**(デプロイ)」を押します。完了すると `https://drivetion.<アカウントのサブドメイン>.workers.dev` が表示されます。この URL を、Google Cloud の「承認済みの JavaScript 生成元」に追加します(1-5)。

以後は `main` に push すると、自動でビルドとデプロイが実行されます。

#### 環境変数の設定場所と再デプロイ
- `VITE_` で始まる変数は **ビルド時** に埋め込まれます。設定場所は Worker の **Settings → Build → Variables and secrets**(**ビルド変数**)です。
  - Settings 直下の「Variables and Secrets」は **実行時** の変数で、ビルドには使われません(このアプリでは使いません)。
- 変数を変えたら、ビルドし直さないと反映されません。次のどちらかで再デプロイします。
  - **Deployments**(デプロイ)タブ → 最新のビルドの詳細を開き、**Retry build**(ビルドを再試行)を押す
  - 空のコミットを push する

    ```bash
    git commit --allow-empty -m "Redeploy"
    ```

    ```bash
    git push
    ```

### 方法 B: ローカルから Wrangler でデプロイ
環境変数はローカルのビルド時に渡します(`.env.local` に書いてもかまいません)。初回は `npx wrangler login` で Cloudflare にログインします。

```bash
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com npm run deploy
```

(`npm run deploy` は `npm run build && wrangler deploy` を実行します)

### 補足
- `public/_headers` で、セキュリティ用のヘッダーと、`sw.js`・`index.html` のキャッシュ無効化を設定しています。Workers の静的ファイル配信でもこのファイルが使われます。`Cross-Origin-Opener-Policy` は GIS のポップアップが動くよう `same-origin-allow-popups` にしています(`same-origin` にするとログインできなくなります)。
- SPA のフォールバック: `wrangler.jsonc` の `"not_found_handling": "single-page-application"` で、存在しないパスへのアクセスにも `index.html` を返します。
- 本番以外のブランチのプレビュー URL は毎回変わるため、Google のログインには使えません。ログインは本番の `workers.dev` の URL(または独自ドメイン)で行ってください。
- ローカルで Workers と同じ配信を確認する場合は、`npm run build` のあと `npx wrangler dev` を実行します。

---

## 4. iPhone で使う

1. Safari でデプロイ先の URL を開き、ログインして動作を確認します。
2. 共有ボタン →「ホーム画面に追加」を選びます。
3. ホーム画面のアイコンから起動します。

### ログインの有効期限について
- アクセストークンの有効期間は約 1 時間です。期限が切れると、画面上部に「再ログイン」バナーが出ます。iPhone ではポップアップを利用者の操作から開く必要があるため、自動では開きません。
- 再ログインまでの間に入力した内容は IndexedDB に一時保存されます。再ログインすると、待機していた保存がそのまま再開されます。
- 期限内であれば、アプリを閉じて開き直してもログインは維持されます(トークンを `localStorage` に保持しています)。

### ホーム画面アプリでログインのポップアップから戻ってこない場合
iOS のバージョンによっては、ホーム画面アプリから開いたポップアップの結果がアプリに戻らないことがあります。その場合は次の手順でリダイレクト方式に切り替えてください。

1. `VITE_AUTH_MODE=auto` を設定します。
2. 1-6 の「承認済みのリダイレクト URI」を登録します。
3. 再デプロイします。

リダイレクト方式ではページが一度移動しますが、編集中の内容は下書きとして残ります。前回開いていたファイルも自動で開き直します。

---

## 5. 動作の詳細

### 保存・マージ・競合検知の流れ
1. ファイルを開いたときに、`version`・`md5Checksum`・内容を基準として記録します(内容は 3-way マージの共通の祖先になります)。
2. 入力が止まって 2 秒後(または画面切り替え時・アプリが裏に回ったとき)に保存を始めます。
3. 保存の直前に `files.get(fields=version,md5Checksum,...)` で現在の状態を確認します。
   - `version` が基準と同じ: そのまま保存します。
   - `version` は違うが `md5Checksum` が同じ(名前変更など、内容以外の変更): 基準を更新して保存します。
   - 内容が違う(他の端末で編集された): Drive 上の最新の内容を取得し、「基準の内容」「Drive 上の内容」「この端末の内容」を **行単位で 3-way マージ** します。
     - 別々の行を編集していれば、合成した内容を保存し、エディタにも反映します(状態表示に「他の端末の変更を反映」と出ます)。
     - 同じ行を両方で変更していれば、**自動保存を止め**、「再読み込み」か「上書き」を選ぶダイアログを出します。この端末の内容をクリップボードにコピーすることもできます。
4. 保存に成功したら、保存した版を新しい基準にし、下書きを削除します。

### 他の端末の更新の取り込み
- アプリ(タブ)が前面に戻ったとき、オンラインに戻ったとき、表示中は 30 秒ごとに、開いているファイルの版を確認します。
- 未保存の変更がなければ、最新の内容をそのままエディタに反映します(スクロール位置は保ちます)。未保存の変更があるときは何もせず、次の自動保存でマージします。
- ログインの有効期限が切れている間は確認しません(バックグラウンドの処理で再ログインを求めないため)。
- リアルタイムの同時編集ではありません。2 台で同時に同じ行を打っている場合は、競合ダイアログになります。

### 既知の制約
- Drive API v3 では条件付き更新(If-Match)が使えないため、「確認してから書く」間にわずかな隙間が残ります。利用者が 1 人なので、実用上は問題にならない想定です。
- `drive.file` スコープのため、アプリ以外で作ったファイルやフォルダは扱えません。
- Milkdown で一度でも編集すると、ファイル全体が Milkdown の書式で書き出されます(空行や記号が整えられます。箇条書きは `-` で書き出します)。
- 自動マージは行単位です。1 行の中の別々の箇所を 2 台で編集した場合も、同じ行の変更として競合になります。
- 画像の貼り付けやアップロードには対応していません(テキストの Markdown 専用です)。

---

## 6. テスト

`e2e/` に、Google Identity Services と Drive API をメモリ上のモックに置き換えた E2E テストがあります。次の流れを確認しています。

- PC: ログイン、フォルダ作成、新規作成、2 秒後の自動保存、競合時の上書きと再読み込み、名前変更後に誤検知しないこと、401 後のトークン再取得と再実行、画面に戻ったときの更新の取り込み、別々の行の変更の自動マージ、チェックボックスの ON/OFF とツールバーでの作成、オフライン時の下書き復元、削除
- iPhone(ホーム画面アプリを模擬): 画面切り替え、トークン失効時に自動でポップアップを開かないこと、「再ログイン」後に保存が再開されること

```bash
npm i -D playwright
```

```bash
npx playwright install chromium
```

```bash
VITE_GOOGLE_CLIENT_ID=test.apps.googleusercontent.com npm run dev
```

別のターミナルで実行します。

```bash
npm run test:e2e
```

`BASE=http://localhost:4173/ npm run test:e2e` とすると、`npm run preview` で動かした本番ビルドに対して実行できます。
