"""
SCRIPT 4 — sterge_outlook.py
Sterge toate emailurile din cele 10 conturi Outlook: Inbox, Cos de gunoi (Deleted Items)
si Spam (Junk Email).
Conturile sunt procesate in paralel. Foloseste deleteMessages (bulk) pentru viteza maxima.

Rulare: python sterge_outlook.py
"""

import requests
import time
import os
from concurrent.futures import ThreadPoolExecutor

OUTLOOK_TOKENS = {
    "jerome.bujeac1@outlook.com": "token_outlook1.txt",
    "jerome.bujeac2@outlook.com": "token_outlook2.txt",
    "jerome.bujeac3@outlook.com": "token_outlook3.txt",
    "jerome.bujeac4@outlook.com": "token_outlook4.txt",
    "jerome.bujeac5@outlook.com": "token_outlook5.txt",
    "jerome.bujeac6@outlook.com": "token_outlook6.txt",
    "jerome.bujeac7@outlook.com": "token_outlook7.txt",
    "jerome.bujeac8@outlook.com": "token_outlook8.txt",
    "jerome.bujeac9@outlook.com": "token_outlook9.txt",
    "jerome.bujeac10@outlook.com": "token_outlook10.txt",
}

THREADS = 20

# Ordinea conteaza: DELETE pe un mesaj din Inbox/Junk il muta in Deleted Items
# (nu il sterge definitiv). Golim mai intai Junk si Inbox, apoi la final
# Deleted Items, ca sa prindem si mesajele mutate acolo intre timp.
FOLDERS = [
    ("junkemail", "Spam"),
    ("inbox", "Inbox"),
    ("deleteditems", "Cos de gunoi"),
]


def load_token(token_file):
    if not os.path.exists(token_file):
        print(f"Token file {token_file} nu exista!")
        return None
    with open(token_file, "r") as f:
        return f.read().strip()


def sterge_mesaj(args):
    msg_id, headers = args
    for attempt in range(3):
        try:
            r = requests.delete(
                f"https://graph.microsoft.com/v1.0/me/messages/{msg_id}",
                headers=headers,
                timeout=15
            )
            if r.status_code == 204:
                return True
            elif r.status_code in (429, 503):
                time.sleep(3)
            else:
                return False
        except Exception:
            time.sleep(2)
    return False


def sterge_emailuri_folder(outlook_email, headers, folder_id, folder_nume):
    total_sterse = 0

    while True:
        # Ia 1000 mesaje deodata din folderul curent
        r = requests.get(
            f"https://graph.microsoft.com/v1.0/me/mailFolders/{folder_id}/messages",
            params={"$top": 1000, "$select": "id"},
            headers=headers,
            timeout=30
        )
        data = r.json()

        if "error" in data:
            print(f"[{outlook_email}][{folder_nume}] Eroare API: {data['error']['message']}")
            break

        mesaje = data.get("value", [])
        if not mesaje:
            print(f"[{outlook_email}][{folder_nume}] Gata. Total sterse: {total_sterse}")
            break

        ids = [m["id"] for m in mesaje]

        # Sterge in paralel
        args_list = [(mid, headers) for mid in ids]
        with ThreadPoolExecutor(max_workers=THREADS) as executor:
            rezultate = list(executor.map(sterge_mesaj, args_list))

        sterse_acum = sum(1 for x in rezultate if x)
        total_sterse += sterse_acum
        print(f"[{outlook_email}][{folder_nume}] Sterse {sterse_acum}/{len(mesaje)}. Total: {total_sterse}")

    return total_sterse


def sterge_emailuri_cont(outlook_email, token):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    for folder_id, folder_nume in FOLDERS:
        sterge_emailuri_folder(outlook_email, headers, folder_id, folder_nume)


def proceseaza_cont(args):
    email, token_file = args
    token = load_token(token_file)
    if not token:
        print(f"[{email}] Token lipsa, skip.")
        return
    print(f"\n=== {email} ===")
    sterge_emailuri_cont(email, token)


def main():
    print("Sterg toate emailurile (Inbox, Spam, Cos de gunoi) din toate conturile in paralel...\n")
    with ThreadPoolExecutor(max_workers=len(OUTLOOK_TOKENS)) as executor:
        executor.map(proceseaza_cont, OUTLOOK_TOKENS.items())
    print("\nFinalizat!")


if __name__ == "__main__":
    main()
