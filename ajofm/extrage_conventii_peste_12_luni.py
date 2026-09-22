import openpyxl, datetime, collections, zipfile, shutil, re, os, sys
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'Foaie_de_lucru_Microsoft_Excel_nou_2.xlsx'
BASE = sys.argv[2] if len(sys.argv) > 2 else '.'
OUT = os.path.join(BASE, 'Conventii_peste_12_luni_de_la_angajare.xlsx')

wb = openpyxl.load_workbook(SRC, data_only=True, read_only=True)
ws = wb['Foaie1']
it = ws.iter_rows(values_only=True)
hdr = list(next(it)); idx = {h: i for i, h in enumerate(hdr)}
rows = [list(r) for r in it]

def d(v):
    if v in (None, ''): return None
    return datetime.datetime.strptime(str(v)[:10], '%Y-%m-%d').date()

def full_months(a, b):
    m = (b.year - a.year) * 12 + (b.month - a.month)
    if b.day < a.day: m -= 1
    return m

peste, eronate = [], []
for r in rows:
    a, c = d(r[idx['data_angajare']]), d(r[idx['data_conv']])
    if a is None or c is None: continue
    m = full_months(a, c)
    if not (1900 <= a.year <= 2030):
        eronate.append((r, a, c, m, 'An eronat la data angajarii in sursa (ex. 0023/0203/0244) - nu se poate evalua criteriul'))
    elif m < 0:
        eronate.append((r, a, c, m, 'Conventie incheiata inaintea datei de angajare'))
    elif m >= 12:
        peste.append((r, a, c, m))

peste.sort(key=lambda t: (t[2] - t[1]).days, reverse=True)

COLS = [('Nr.', 6), ('Judet / AJOFM', 20), ('CUI angajator', 13), ('Denumire angajator', 34),
        ('CNP', 15), ('Nume si prenume', 28), ('Categorie somer', 16), ('Nr. conventie', 12),
        ('Data angajare', 14), ('Data conventie', 14),
        ('Luni de la angajare', 12), ('Zile de la angajare', 12),
        ('Data contract munca', 15), ('Status contract', 22), ('Localitate', 22), ('Finantare', 14)]
SRC_KEYS = ['judet', 'cui', 'denang', 'cnp', 'numepren', 'tip_somer', 'nr_conv']

HFILL = PatternFill('solid', fgColor='1F3864')
HFONT = Font(name='Arial', size=10, bold=True, color='FFFFFF')
BODY = Font(name='Arial', size=10)
KEY = Font(name='Arial', size=10, bold=True)
KFILL = PatternFill('solid', fgColor='FFF2CC')
T = Side(style='thin', color='BFBFBF')
BORD = Border(left=T, right=T, top=T, bottom=T)

cached = {}   # {sheet_title: {cell_ref: value}}

def write_sheet(sh, data, annex=False):
    cols = COLS + ([('Observatie', 52)] if annex else [])
    for j, (name, w) in enumerate(cols, start=1):
        c = sh.cell(row=1, column=j, value=name)
        c.font, c.fill, c.border = HFONT, HFILL, BORD
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        sh.column_dimensions[get_column_letter(j)].width = w
    sh.row_dimensions[1].height = 30
    cache = cached.setdefault(sh.title, {})

    for i, tup in enumerate(data):
        r, a, c, m = tup[0], tup[1], tup[2], tup[3]
        xl = i + 2
        # in anexa, datele cu an eronat se scriu ca text (Excel nu accepta date < 1900)
        a_v = a if (1900 <= a.year <= 9999) else a.isoformat()
        vals = [i + 1] + [r[idx[k]] for k in SRC_KEYS] + [a_v, c, None, None,
                d(r[idx['data_contr_munca']]), r[idx['status_contr_munca']],
                r[idx['localitate']], r[idx['finantare']]]
        dcm = vals[12]
        if dcm is not None and not (1900 <= dcm.year <= 9999):
            vals[12] = dcm.isoformat()
        if annex: vals.append(tup[4])
        for j, v in enumerate(vals, start=1):
            cell = sh.cell(row=xl, column=j, value=v)
            cell.font, cell.border = BODY, BORD
        for col in (9, 10):
            sh.cell(row=xl, column=col).font = KEY
            sh.cell(row=xl, column=col).fill = KFILL
        for col in (9, 10, 13):
            cc = sh.cell(row=xl, column=col)
            if isinstance(cc.value, (datetime.date, datetime.datetime)):
                cc.number_format = 'DD.MM.YYYY'
            cc.alignment = Alignment(horizontal='center')
        if annex:
            # fara formule pe anexa: datele pot fi text; se scriu valorile calculate
            sh.cell(row=xl, column=11, value=(m if 1900 <= a.year <= 2030 else 'n/a'))
            sh.cell(row=xl, column=12, value=((c - a).days if 1900 <= a.year <= 2030 else 'n/a'))
        else:
            sh.cell(row=xl, column=11, value=f'=DATEDIF(I{xl},J{xl},"m")')
            sh.cell(row=xl, column=12, value=f'=J{xl}-I{xl}')
            cache[f'K{xl}'] = m
            cache[f'L{xl}'] = (c - a).days
        for col in (11, 12):
            cc = sh.cell(row=xl, column=col)
            cc.font, cc.number_format = KEY, '0'
            cc.alignment = Alignment(horizontal='center')
        for col in (3, 5):
            sh.cell(row=xl, column=col).number_format = '@'
        sh.cell(row=xl, column=1).alignment = Alignment(horizontal='center')
    sh.freeze_panes = 'A2'
    if data:
        sh.auto_filter.ref = f'A1:{get_column_letter(len(cols))}{len(data) + 1}'

out = openpyxl.Workbook()
s1 = out.active; s1.title = 'Peste 12 luni'
write_sheet(s1, peste)
s2 = out.create_sheet('Date eronate')
write_sheet(s2, eronate, annex=True)

s3 = out.create_sheet('Sumar', 0)
cache3 = cached.setdefault('Sumar', {})
for col, w in (('A', 48), ('B', 16), ('C', 62)):
    s3.column_dimensions[col].width = w
t = s3.cell(row=1, column=1, value='Persoane cu conventie incheiata la 12 luni sau mai mult de la angajare')
t.font = Font(name='Arial', size=13, bold=True, color='1F3864')
s3.merge_cells('A1:C1')

n = len(peste)
info = [
    ('Fisier sursa', 'Foaie de lucru Microsoft Excel nou 2.xlsx', 'foaia "Foaie1"'),
    ('Total inregistrari analizate', len(rows), 'o inregistrare = o persoana la un angajator (combinatie CNP + CUI unica)'),
    ('Criteriu aplicat', 'Data conventie - Data angajare >= 12 luni intregi',
     'coloanele sursa data_conv si data_angajare; luni calendaristice intregi'),
    ('Persoane identificate - foaia "Peste 12 luni"', n, 'sortate descrescator dupa zilele scurse de la angajare'),
    ('Inregistrari cu date neutilizabile - foaia "Date eronate"', len(eronate),
     'excluse din rezultat: an de angajare evident gresit in sursa, sau conventie anterioara angajarii'),
    ('Data prelucrarii', datetime.date.today(), None),
]
r0 = 3
for k, v, note in info:
    s3.cell(row=r0, column=1, value=k).font = KEY
    c = s3.cell(row=r0, column=2, value=v)
    c.font = BODY; c.alignment = Alignment(horizontal='left')
    if isinstance(v, datetime.date): c.number_format = 'DD.MM.YYYY'
    if note: s3.cell(row=r0, column=3, value=note).font = Font(name='Arial', size=9, italic=True, color='595959')
    r0 += 1

r0 += 1
s3.cell(row=r0, column=1, value='Distributie pe intervale de intarziere').font = Font(name='Arial', size=11, bold=True)
r0 += 1
for lbl, col in (('Interval', 1), ('Persoane', 2)):
    c = s3.cell(row=r0, column=col, value=lbl); c.font, c.fill, c.border = HFONT, HFILL, BORD
r0 += 1
bands = [('12 - 12,9 luni', 12, 13), ('13 - 14,9 luni', 13, 15), ('15 - 17,9 luni', 15, 18),
         ('18 - 23,9 luni', 18, 24), ('24 luni si peste', 24, 100000)]
first = r0
for lbl, lo, hi in bands:
    s3.cell(row=r0, column=1, value=lbl).font = BODY
    f = (f"=COUNTIFS('Peste 12 luni'!$K$2:$K${n+1},\">=\"&{lo},"
         f"'Peste 12 luni'!$K$2:$K${n+1},\"<\"&{hi})")
    c = s3.cell(row=r0, column=2, value=f)
    c.font = BODY; c.alignment = Alignment(horizontal='center')
    cache3[f'B{r0}'] = sum(1 for t2 in peste if lo <= t2[3] < hi)
    for col in (1, 2): s3.cell(row=r0, column=col).border = BORD
    r0 += 1
s3.cell(row=r0, column=1, value='TOTAL').font = KEY
c = s3.cell(row=r0, column=2, value=f'=SUM(B{first}:B{r0-1})')
c.font, c.alignment = KEY, Alignment(horizontal='center')
cache3[f'B{r0}'] = n
for col in (1, 2):
    s3.cell(row=r0, column=col).border = BORD
    s3.cell(row=r0, column=col).fill = KFILL

r0 += 2
s3.cell(row=r0, column=1, value='Repartizare pe judete / AJOFM').font = Font(name='Arial', size=11, bold=True)
r0 += 1
for lbl, col in (('Judet / AJOFM', 1), ('Persoane', 2)):
    c = s3.cell(row=r0, column=col, value=lbl); c.font, c.fill, c.border = HFONT, HFILL, BORD
r0 += 1
cnt = collections.Counter(t2[0][idx['judet']] for t2 in peste)
for j, k in sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0])):
    s3.cell(row=r0, column=1, value=j).font = BODY
    c = s3.cell(row=r0, column=2, value=f"=COUNTIF('Peste 12 luni'!$B$2:$B${n+1},$A{r0})")
    c.font, c.alignment = BODY, Alignment(horizontal='center')
    cache3[f'B{r0}'] = k
    for col in (1, 2): s3.cell(row=r0, column=col).border = BORD
    r0 += 1
s3.cell(row=r0, column=1, value='TOTAL').font = KEY
c = s3.cell(row=r0, column=2, value=f"=SUM(B{r0-len(cnt)}:B{r0-1})")
c.font, c.alignment = KEY, Alignment(horizontal='center')
cache3[f'B{r0}'] = n
for col in (1, 2):
    s3.cell(row=r0, column=col).border = BORD
    s3.cell(row=r0, column=col).fill = KFILL

out.save(OUT)

# ---- injecteaza valorile calculate ca <v> langa fiecare <f> (LibreOffice indisponibil) ----
order = out.sheetnames
tmp = OUT + '.tmp'
zin = zipfile.ZipFile(OUT)
zout = zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED)
sheet_file = {f'xl/worksheets/sheet{i+1}.xml': order[i] for i in range(len(order))}
patched = 0
for item in zin.infolist():
    data = zin.read(item.filename)
    if item.filename in sheet_file:
        title = sheet_file[item.filename]
        cache = cached.get(title, {})
        if cache:
            xml = data.decode('utf-8')
            def repl(mo):
                global patched
                ref, inner = mo.group(1), mo.group(0)
                if '<f>' not in inner or ref not in cache:
                    return inner
                patched += 1
                v = cache[ref]
                return re.sub(r'(</f>)(?!<v>)', r'\1<v>%s</v>' % v, inner, count=1)
            xml = re.sub(r'<c r="([A-Z]+[0-9]+)"[^>]*>.*?</c>', repl, xml)
            data = xml.encode('utf-8')
    zout.writestr(item, data)
zin.close(); zout.close()
shutil.move(tmp, OUT)
print('saved', OUT)
print('peste 12 luni:', n, '| date eronate:', len(eronate), '| formule cu valoare injectata:', patched)
