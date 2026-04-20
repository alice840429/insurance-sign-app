# 保險簽署平台 clone

這是一個可自行架設的 Node.js 版本，功能包含：

- 業務後台上傳 JPG/PNG 要保書
- 自動附加 4 張制式文件圖片
- 產生客戶簽署連結
- 客戶逐頁簽名
- 產生已簽署 PDF

## 本機啟動

```bash
npm install
npm start
```

開啟：

```bash
http://localhost:3000
```

## Render 部署

- Build Command: `npm install`
- Start Command: `npm start`
- Node 版本建議 20+

## 限制

- 目前是可用版，不是完全 1:1 邏輯複製。
- 簽名會統一蓋在每頁右下角。
- 若你要指定每張表單不同簽名位置，我可以再幫你升級成座標配置版。
- 若你要 LINE LIFF 開啟、雲端刪檔、自動寄送、管理登入，也可以再加。
