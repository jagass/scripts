"""
Fereastra cu buton pentru actualizarea tabelului Excel cu meciuri de pe Flashscore.
Pornire: dublu-click pe Porneste.bat (sau: pythonw flashscore_gui.py).
"""
import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from datetime import date, datetime, timedelta
from tkinter import ttk

import flashscore_excel as fs

DAYS_RO = ["Luni", "Marti", "Miercuri", "Joi", "Vineri", "Sambata", "Duminica"]
OUT_FILE = os.path.join(fs.HERE, "meciuri_flashscore.xlsx")


def day_options():
    today = date.today()
    options = []
    for offset in range(-7, 8):
        day = today + timedelta(days=offset)
        label = {-1: "Ieri", 0: "Azi", 1: "Maine"}.get(offset, DAYS_RO[day.weekday()])
        options.append((f"{label}  {day:%d.%m.%Y}", offset))
    return options


def open_file(path):
    if sys.platform.startswith("win"):
        os.startfile(path)
    elif sys.platform == "darwin":
        subprocess.call(["open", path])
    else:
        subprocess.call(["xdg-open", path])


class App:
    def __init__(self, root):
        self.root = root
        self.messages = queue.Queue()
        self.options = day_options()
        root.title("Flashscore -> Excel")
        root.geometry("560x420")

        frame = ttk.Frame(root, padding=12)
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="Ziua:").grid(row=0, column=0, sticky="w")
        self.day = ttk.Combobox(frame, state="readonly", width=28,
                                values=[label for label, _ in self.options])
        self.day.current(7)
        self.day.grid(row=0, column=1, sticky="w", pady=4)

        ttk.Label(frame, text="Filtru tari/competitii:").grid(row=1, column=0, sticky="w")
        self.filter = ttk.Entry(frame, width=40)
        self.filter.grid(row=1, column=1, sticky="w", pady=4)
        ttk.Label(frame, foreground="gray",
                  text="optional, separate prin virgula, ex: romania, premier league\n"
                       "gol = toate meciurile (dureaza mai mult)").grid(row=2, column=1, sticky="w")

        self.button = ttk.Button(frame, text="Actualizeaza datele", command=self.start)
        self.button.grid(row=3, column=0, columnspan=2, pady=10, ipadx=20, ipady=6)

        self.log = tk.Text(frame, height=12, width=66, state="disabled")
        self.log.grid(row=4, column=0, columnspan=2, sticky="nsew")
        frame.rowconfigure(4, weight=1)
        frame.columnconfigure(1, weight=1)

        root.after(200, self.poll)

    def write(self, text):
        self.messages.put(text)

    def poll(self):
        while not self.messages.empty():
            text = self.messages.get()
            if text == "__DONE__":
                self.button.config(state="normal")
                continue
            self.log.config(state="normal")
            self.log.insert("end", text + "\n")
            self.log.see("end")
            self.log.config(state="disabled")
        self.root.after(200, self.poll)

    def start(self):
        offset = self.options[self.day.current()][1]
        filters = [f for f in self.filter.get().split(",") if f.strip()]
        self.button.config(state="disabled")
        self.log.config(state="normal")
        self.log.delete("1.0", "end")
        self.log.config(state="disabled")
        threading.Thread(target=self.run, args=(offset, filters), daemon=True).start()

    def run(self, offset, filters):
        try:
            matches = fs.collect(offset, filters, progress=self.write)
            if not matches:
                self.write("Nu am gasit niciun meci.")
                return
            path = OUT_FILE
            try:
                fs.write_excel(matches, path)
            except PermissionError:
                # fisierul e deschis in Excel si e blocat - salvam sub alt nume
                path = OUT_FILE.replace(".xlsx", f"_{datetime.now():%H%M%S}.xlsx")
                fs.write_excel(matches, path)
                self.write("Fisierul vechi era deschis in Excel, am salvat intr-unul nou.")
            self.write(f"Gata! {len(matches)} meciuri salvate. Deschid Excel...")
            open_file(path)
        except Exception as error:  # afisam orice eroare in fereastra
            self.write(f"EROARE: {error}")
        finally:
            self.write("__DONE__")


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
