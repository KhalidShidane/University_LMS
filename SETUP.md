# Hagaha rakibidda (Docker la'aan)

Hagahan wuxuu kuu sheegayaa sida system-ka (Hormuud University LMS) loogu shido kombiyuutarkaaga **Docker la'aan**: Node.js + MongoDB oo keliya.

> Faylka `.env.docker.example` waa kaliya dadka Docker isticmaala. Adiga waxaad isticmaalaysaa `server/.env.example`.

---

## 1. Waxyaabaha loo baahan yahay (hal mar)

| Barnaamij | Nooca | Halka laga soo dejiyo |
| --- | --- | --- |
| **Git** | kii ugu dambeeyay | https://git-scm.com/downloads |
| **Node.js** | **22 LTS** (ama 20.19+) | https://nodejs.org |
| **MongoDB Community Server** | 7.x | https://www.mongodb.com/try/download/community (dooro "Install MongoD as a Service") |

Hubi in ay si sax ah u rakibmeen (PowerShell):

```powershell
git --version
node -v
npm -v
```

MongoDB wuxuu u shaqeeyaa sidii **Windows Service**; inta badan wuu iska bilaabmaa. Haddii kale: *Services → MongoDB Server → Start*.

---

## 2. Soo dejiso code-ka

Marka ugu horreysa:

```powershell
git clone https://github.com/KhalidShidane/University_LMS.git
cd University_LMS
```

Haddii aad hore u haysatay, ku cusboonaysii:

```powershell
cd University_LMS
git pull
```

---

## 3. Rakib dependencies-ka

```powershell
npm install
```

(Waxay qaadan kartaa dhowr daqiiqo marka ugu horreysa.)

---

## 4. Samee faylka settings-ka (`server/.env`)

```powershell
Copy-Item server/.env.example server/.env
```

Kadib fur `server/.env` (Notepad ama VS Code), oo beddel kuwan:

| Variable | Waxa la gelinayo |
| --- | --- |
| `JWT_SECRET` | Qoraal random ah oo dheer. Samee adigoo isticmaalaya amarka hoose. |
| `ADMIN_EMAIL` | Email-ka admin-ka (ha isticmaalin `admin@example.edu`) |
| `ADMIN_PASSWORD` | Password xooggan, ugu yaraan 12 xaraf |
| `RESEND_API_KEY` | Key-ga email-ka. **Weydii Mohamed si gaar ah**; ha dhigin GitHub ama chat. Haddii aad email u baahnayn, banaan ka tag. |

`JWT_SECRET` sidan ku samee (PowerShell), kadib natiijada ku dheji:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`MONGODB_URI`, `CLIENT_URL`, `APP_URL` sidooda ka tag (local ayay u diyaarsan yihiin).

> ⚠️ `server/.env` **waligiis GitHub lama gelin** (`.gitignore` ayaa ilaaliya). Sirta halkaas ayay ku jirtaa.

---

## 5. Samee account-ka admin-ka (hal mar)

```powershell
npm run seed:admin
```

Waa inuu soo baxaa: `Administrator account created for ...`

---

## 6. Shid system-ka

```powershell
npm run dev
```

Kadib browser-ka ka fur: **http://localhost:5173**

- Website-ka: `http://localhost:5173`
- API-ga: `http://localhost:5001` (si toos ah uma baahnid)

Joojinta: `Ctrl + C` terminal-ka.

---

## 7. Maalin walba (marka shaqo cusub la soo riixo)

```powershell
git pull
npm install
npm run dev
```

`npm install` waxaa loo baahan yahay oo keliya marka package cusub lagu daro, laakiin wax dhib ah ma keeno haddii la socodsiiyo.

---

## 8. Tijaabooyinka (ikhtiyaari)

```powershell
npm test
```

Test-yada database-ka u baahan waxay socdaan oo keliya marka la dejiyo `MONGODB_TEST_URI` (database tijaabo ah oo gooni ah):

```powershell
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/lms_test"
npm test
```

---

## Dhibaatooyinka caadiga ah

| Dhibaato | Xal |
| --- | --- |
| `MongoDB is unavailable` / `database: disconnected` | MongoDB ma shidna. *Services → MongoDB Server → Start*. |
| `Port 5001 is already in use` | Server kale ayaa socda. Xir terminal-kii hore ama dib u kici kombiyuutarka. |
| Login: "Too many sign-in attempts" | Password khaldan 8 jeer ayaa la isku dayay. Sug 15 daqiiqo. |
| Email ma imanayo | `RESEND_API_KEY` ma jiro ama waa khalad. Weydii Mohamed. |
| `npm install` wuu fashilmay | Hubi Node.js 20.19+ ama 22. Tirtir `node_modules` kadibna mar kale `npm install`. |

---

## Sharciyada GitHub-ka

- **Ha push garayn** `server/.env` ama sir kasta (password, API key).
- Ka hor intaadan shaqo bilaabin: `git pull`.
- Marka aad dhammayso:

```powershell
git add .
git commit -m "Sharaxaad gaaban oo waxa aad beddeshay"
git push
```
