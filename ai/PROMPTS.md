# Prompturi gata de folosit — Brewtality-3-16

Set de prompturi pentru Claude Code (sau alt agent AI cu acces la terminal și fișiere),
gata de copiat, pentru fiecare etapă a derivării unui scraper nou din acest template.

> ⚠️ Aceste prompturi presupun un agent cu acces real la sistem (terminal, fișiere, git).
> Verifică scope-ul și folderul curent înainte să le rulezi — mai ales Prompt 3 (creare
> repo public) și Prompt 5 (push).

---

## 1. Verificare țintă înainte de a începe

Folosește-l ÎNAINTE să alegi o companie, ca să nu pierzi timp pe un site blocat sau
deja acoperit.

Verifică pentru compania [NUME COMPANIE]:
1. Caut-o pe peviitor.ro (bara de căutare, filtru Companie) — apare deja acolo?
2. Dacă nu apare, verifică robots.txt de pe [WEBSITE] — permite accesul pe pagina
   de cariere ([URL PAGINĂ CARIERE])?
3. Confirmă că pagina de cariere are joburi active vizibile acum (nu 0).

Răspunde clar: LIBERĂ (poți continua) sau OCUPATĂ/BLOCATĂ (motivul exact), fără
să presupui nimic ce nu ai verificat direct.

---

## 2. Derivare scraper nou din template

Rulează după ce ai confirmat compania e liberă (Prompt 1).

Suntem în folderul Brewtality-3-16. Rulează scriptul de derivare interactiv
(node setup.js sau python setup.py — întreabă-mă care limbaj vreau dacă nu
ți-am spus deja) și completează cu:
- Companie: [NUME LEGAL COMPLET]
- Brand: [NUME BRAND PUBLIC]
- CIF: [CIF]
- Website: [URL]
- Pagină cariere: [URL CARIERE]
- Oraș sediu: [ORAȘ]
- Selectori CSS primari (dacă îi știu deja): [SAU: apasă Enter, folosește doar
  fallback-urile generice]
- GitHub owner: [USERNAME] / repo: [nume-repo-slug]

După derivare, rulează testele locale (unit + consistency) și arată-mi rezultatul
înainte să facem orice commit.

---

## 3. Creare repo + primul push

Rulează după ce testele locale de la Prompt 2 sunt verzi.

Testele locale sunt verzi. Acum:
1. git init (dacă nu există deja) + git add -A + primul commit
2. Creează repo-ul pe GitHub — PUBLIC (nu privat), branch implicit main
3. Setează topic-urile corecte (verifică ai/TOPICS.md pentru convenția exactă)
4. Fă push
5. Verifică că workflow-urile CI pornesc și devin verzi (gh run list / gh run watch)

Oprește-te și întreabă-mă înainte de orice acțiune ireversibilă în afara acestui
repo nou (ex. nu atinge alte repo-uri de-ale mele).

---

## 4. Diagnosticare când CI e roșu / testele pică

Folosește-l oricând un workflow eșuează sau un test pică local.

[Workflow-ul X / testul Y] a picat. Investighează concret, nu ghici:
1. Arată-mi logul exact al erorii (gh run view --log pentru CI, sau output-ul
   complet al testului local)
2. Explică pe scurt cauza reală (nu presupune — citește eroarea)
3. Propune fix-ul minim necesar, fără să modifici altceva în plus
4. Rulează din nou testele relevante după fix, confirmă că trec

Nu face commit până nu confirmi că problema e rezolvată local.

---

## 5. Verificare self-healing pe scraperul nou

Rulează după primul scrape reușit, ca să confirmi că fallback-urile chiar funcționează,
nu doar că selectorul principal a mers din prima.

Vreau să confirm că self-healing-ul funcționează pe scraperul pentru [NUME COMPANIE],
nu doar că selectorul principal găsește joburile acum. Simulează local (fără să
modifici site-ul real):
1. Modifică temporar fixture-ul de test HTML ca și cum selectorul principal
   (ex. clasa CSS) s-ar fi schimbat
2. Rulează testele de self-healing — confirmă că fallback-ul (nivelul 2, apoi 3)
   preia corect și tot găsește joburile
3. Arată-mi rezultatul și restaurează fixture-ul original după test

Nu implementa fallback-uri suplimentare doar pentru asta — verifică doar ce există deja.

---

## Notă

Aceste prompturi sunt puncte de plecare, nu texte rigide — completează parantezele
drepte cu datele reale ale companiei tale și ajustează după nevoie. Dacă un agent
AI cere confirmare suplimentară înainte de o acțiune (ex. push pe GitHub, ștergere
fișiere), e comportament normal de siguranță — confirmă doar după ce ai verificat
tu însuți ce urmează să se întâmple.
