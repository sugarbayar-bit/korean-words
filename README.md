# 한국어 Words — Korean vocabulary trainer

A small mobile-first website for learning Korean words and phrases by category,
with 4-choice tests in both directions (Korean ↔ English / Mongolian).

- **Hosting:** GitHub Pages (free)
- **Database + login:** Supabase (free)
- **Auto-fill meanings:** MyMemory translation API (free)
- **Test stats:** saved in each visitor's own browser, never on the server

## Files

| File | What it is |
|---|---|
| `index.html`, `style.css`, `app.js` | The website |
| `config.js` | Your Supabase URL and key (**you edit this**) |
| `schema.sql` | Database setup, run once in Supabase |
| `seed.sql` | Optional starter words |

---

## Setup (about 15–20 minutes)

### 1. Create the database (Supabase)
1. Open your Supabase dashboard → **New project**. Pick a name and password, and choose
   **Northeast Asia (Seoul)** as the region.
2. Wait until the project is ready, then open **SQL Editor** → **New query**.
3. Paste all of `schema.sql`. **Change `you@example.com` to your own email.**
   Click **Run**. You should see "Success".
4. *(Optional)* New query → paste `seed.sql` → **Run** to add 14 starter words.

### 2. Create your login
1. **Authentication → Users → Add user → Create new user**.
2. Enter the **same email** as in step 1.3, plus a password. Tick **Auto Confirm User**.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up".
   Nobody else can make an account then. (Even if they could, the database rules
   only allow your email to make changes.)

### 3. Connect the website to the database
1. In Supabase open **Project Settings → Data API** (or **API**) and copy the **Project URL**.
2. Open **Project Settings → API Keys** and copy the **Publishable key**
   (on older projects it's the **anon public** key).
   ⚠️ Do **not** use the *secret* or *service_role* key.
3. Paste both values into `config.js`.

### 4. Put it online (GitHub Pages)
1. On GitHub: **New repository** → name it `korean-words` → **Public** → Create.
2. Click **uploading an existing file** and drag in `index.html`, `style.css`,
   `app.js`, `config.js` and `README.md`. Click **Commit changes**.
   (You don't need to upload the `.sql` files.)
3. Open **Settings → Pages**. Under *Build and deployment* choose
   **Deploy from a branch → main → / (root)** → **Save**.
4. After 1–2 minutes your site is live at
   `https://YOUR-GITHUB-USERNAME.github.io/korean-words/`

### 5. Put it on your phone
Open the link on your phone:
- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ menu → *Add to Home screen*

Then go to **Manage**, log in, and start adding words.

---

## How to use it

**Manage** (owner only)
- Add, rename or delete categories (deleting a category deletes its words too).
- Add a word: type the Korean → **✨ Auto-fill** fills empty English/Mongolian fields →
  edit if needed → **Add word**. If both meanings are already filled, Auto-fill replaces them.
- You get a warning if the Korean word is already saved.
- **Possible synonyms** chips show saved words with a similar meaning. Tap one to add it.
- Tap any word in the list to edit or delete it.

**Test** (everyone)
- Choose categories, direction, meaning language (English / Монгол / Both),
  number of questions, and *All words* or *My weak words*.
- Wrong answers come from the same category first.
- Synonyms and words with the same meaning are never shown as wrong answers.
- On a computer, keys 1–4 answer and Enter moves on.

**My stats** (per device)
- Shows your most-missed words with ✗/✓ counts.
- ↺ resets one word. **Reset all my stats** clears everything.
- **Practice weak words** starts a test with only your most-missed words.

## Notes
- Mongolian auto-translation is weaker than English. Always check it.
- The free translation API allows about 5,000 characters a day. To raise it, put an email in
  `TRANSLATE_EMAIL` in `config.js` (this file is public on GitHub).
- To update the site later, edit the file on GitHub (pencil icon) or upload a
  new version. GitHub Pages republishes in about a minute.
- Without a filled-in `config.js`, the site runs in **demo mode** with sample words.
