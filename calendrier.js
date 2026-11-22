/* ============================================================
   Calendrier d'ouverture, commun aux deux onglets.

   Trois règles, dans cet ordre :
     1. un jour rouvert exprès est ouvert ;
     2. sinon, un jour compris dans des congés est fermé ;
     3. sinon, le mercredi et le jeudi sont fermés.

   Le calendrier est rangé sur le serveur des températures, dans un
   enregistrement réservé (voir CLE_SERVEUR) : tous les appareils le
   partagent. Rien n'est jamais effacé du serveur (il ne sait qu'ajouter) :
   une entrée retirée passe de 1 à 0.

   Chargé avant fournil.js ; utilise $(), toast() et pushServeur() de
   fournil.js au moment des clics.
   ============================================================ */
const Calendrier = (() => {
  "use strict";

  // Date fictive qui reste toujours en tête : le serveur ne garde que les jours les plus récents.
  const CLE_SERVEUR = "9999-12-31";
  const CLE_LOCAL = "bdm_calendrier_v1";
  const JOURS_FERMES = [3, 4]; // 0 = dimanche … 3 = mercredi, 4 = jeudi
  const NOMS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const RE_JOUR = /^\d{4}-\d{2}-\d{2}$/;
  const RE_CONGE = /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const deIso = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12);
  const dateLongue = (s) => deIso(s).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const dateCourte = (s) => s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4);
  const aujourdhuiIso = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  /** Ne garde que des dates bien formées, avec la valeur 1 (actif) ou 0 (retiré). */
  function nettoyer(brut) {
    const propre = { conges: {}, ouverts: {} };
    if (!brut || typeof brut !== "object") return propre;
    const copier = (source, cible, re) => {
      if (!source || typeof source !== "object" || Array.isArray(source)) return;
      Object.keys(source).forEach((k) => { if (re.test(k)) cible[k] = source[k] === 1 ? 1 : 0; });
    };
    copier(brut.conges, propre.conges, RE_CONGE);
    copier(brut.ouverts, propre.ouverts, RE_JOUR);
    return propre;
  }

  let cal;
  try { cal = nettoyer(JSON.parse(localStorage.getItem(CLE_LOCAL) || "{}")); } catch (e) { cal = nettoyer(null); }
  let dernierChangement = 0;
  const abonnes = [];
  const prevenir = () => abonnes.forEach((f) => { try { f(); } catch (e) { console.error("calendrier", e); } });
  const garder = () => { try { localStorage.setItem(CLE_LOCAL, JSON.stringify(cal)); } catch (e) {} };

  /* ---------- Règles ---------- */
  function fermetureDeBase(iso) {
    const conge = Object.keys(cal.conges).find((k) => cal.conges[k] === 1 && iso >= k.slice(0, 10) && iso <= k.slice(11));
    if (conge) return "congés annuels";
    const jour = deIso(iso).getDay();
    return JOURS_FERMES.includes(jour) ? "fermé le " + NOMS[jour] : null;
  }

  /** { ferme, rouvert, raison } pour un jour. */
  function etat(iso) {
    const raison = fermetureDeBase(iso);
    if (cal.ouverts[iso] === 1) return { ferme: false, rouvert: !!raison, raison: raison || "" };
    return { ferme: !!raison, rouvert: false, raison: raison || "" };
  }

  /** Bandeau à afficher en haut d'un jour. Un jour fermé qui contient déjà des saisies reste affiché. */
  function bandeau(iso, aDesSaisies, quoi) {
    const e = etat(iso);
    if (e.ferme && !aDesSaisies) {
      return { ferme: true, html: `<div class="c-ferme">
          <b>🔒 Boulangerie fermée</b>
          <span>${esc(dateLongue(iso))} — ${esc(e.raison)}. Pas de ${esc(quoi)} à saisir.</span>
          <button type="button" class="c-btn" data-cal="rouvrir" data-date="${esc(iso)}">🔓 Ouvrir exceptionnellement ce jour</button>
          <button type="button" class="c-lien" data-cal="gestion">Gérer les fermetures et congés</button>
        </div>` };
    }
    if (e.ferme) {
      return { ferme: false, html: `<div class="c-note">Jour normalement fermé (${esc(e.raison)}). Des saisies existent déjà : elles restent affichées.</div>` };
    }
    if (e.rouvert) {
      return { ferme: false, html: `<div class="c-note">🔓 Jour ouvert exceptionnellement
          <button type="button" class="c-lien" data-cal="refermer" data-date="${esc(iso)}">Refermer</button></div>` };
    }
    return { ferme: false, html: "" };
  }

  /* ---------- Synchronisation (appelée par fournil.js) ---------- */
  const pourServeur = () => ({ conges: cal.conges, ouverts: cal.ouverts });

  /** Reçoit la version du serveur. Un changement local tout récent ou pas encore envoyé garde la priorité. */
  function recevoir(enregistrement) {
    const serveur = nettoyer(enregistrement);
    const localPrioritaire = Date.now() - dernierChangement < 8000 || !!localStorage.getItem("bdm_fournil_attente");
    const neuf = localPrioritaire
      ? { conges: Object.assign({}, serveur.conges, cal.conges), ouverts: Object.assign({}, serveur.ouverts, cal.ouverts) }
      : serveur;
    if (JSON.stringify(neuf) === JSON.stringify(cal)) return;
    cal = neuf;
    garder();
    prevenir();
    if (!$("c_feuille").hidden) rendreGestion();
  }

  function changer(modifier) {
    modifier();
    dernierChangement = Date.now();
    garder();
    prevenir();
    if (!$("c_feuille").hidden) rendreGestion();
    const envoi = {};
    envoi[CLE_SERVEUR] = pourServeur();
    pushServeur(envoi);
  }

  /* ---------- Écran « Fermetures et congés » ---------- */
  function rendreGestion() {
    const auj = aujourdhuiIso();
    const conges = Object.keys(cal.conges).filter((k) => cal.conges[k] === 1).sort();
    const ouverts = Object.keys(cal.ouverts).filter((k) => cal.ouverts[k] === 1).sort();
    const nbJours = (k) => Math.round((deIso(k.slice(11)) - deIso(k.slice(0, 10))) / 86400000) + 1;
    $("c_corps").innerHTML = `
      <div class="l-bloc">
        <div class="l-petit-titre">Fermeture chaque semaine</div>
        <p class="c-texte">Mercredi et jeudi.</p>
        <p class="l-aide">Ces jours-là, ni relevé de température ni livraison à saisir. Pour un mercredi ou un jeudi de fête, ajoutez-le plus bas dans « Jours ouverts exceptionnellement ».</p>
      </div>
      <div class="l-bloc">
        <div class="l-petit-titre">Congés annuels</div>
        ${conges.map((k) => `<div class="c-ligne${k.slice(11) < auj ? " passe" : ""}">
            <span>du ${esc(dateCourte(k.slice(0, 10)))} au ${esc(dateCourte(k.slice(11)))} · ${nbJours(k)} jour${nbJours(k) > 1 ? "s" : ""}</span>
            <button type="button" class="l-mini danger" data-cal="retirerConge" data-cle="${esc(k)}" aria-label="Retirer ces congés">✕</button>
          </div>`).join("") || `<p class="l-aide">Aucune période de congés enregistrée.</p>`}
        <div class="c-form">
          <label>Du <input type="date" id="c_du"></label>
          <label>au <input type="date" id="c_au"></label>
          <button type="button" class="l-btn" data-cal="ajouterConge">Ajouter</button>
        </div>
      </div>
      <div class="l-bloc">
        <div class="l-petit-titre">Jours ouverts exceptionnellement</div>
        ${ouverts.map((k) => `<div class="c-ligne${k < auj ? " passe" : ""}">
            <span>${esc(dateLongue(k))}</span>
            <button type="button" class="l-mini danger" data-cal="refermer" data-date="${esc(k)}" aria-label="Refermer ce jour">✕</button>
          </div>`).join("") || `<p class="l-aide">Aucun jour rouvert.</p>`}
        <div class="c-form">
          <label>Jour <input type="date" id="c_jour"></label>
          <button type="button" class="l-btn" data-cal="ouvrirJour">Ouvrir ce jour</button>
        </div>
      </div>`;
  }

  function ouvrirGestion() {
    rendreGestion();
    $("c_feuille").hidden = false;
    document.body.style.overflow = "hidden";
    $("c_corps").scrollTop = 0;
  }
  function fermerGestion() {
    $("c_feuille").hidden = true;
    document.body.style.overflow = $("l_feuille").hidden ? "" : "hidden";
  }

  function ajouterConge() {
    const du = $("c_du").value, au = $("c_au").value || du;
    if (!RE_JOUR.test(du) || !RE_JOUR.test(au)) { toast("Choisissez la date de début et la date de fin"); return; }
    if (au < du) { toast("La date de fin est avant la date de début"); return; }
    if ((deIso(au) - deIso(du)) / 86400000 > 92) { toast("Une période ne peut pas dépasser 3 mois"); return; }
    changer(() => { cal.conges[du + "_" + au] = 1; });
    toast("✓ Congés enregistrés");
  }

  function ouvrirJour() {
    const d = $("c_jour").value;
    if (!RE_JOUR.test(d)) { toast("Choisissez un jour"); return; }
    if (!fermetureDeBase(d)) { toast("Ce jour est déjà ouvert normalement"); return; }
    changer(() => { cal.ouverts[d] = 1; });
    toast("✓ Jour ouvert");
  }

  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-cal]");
    if (!b) return;
    const d = b.dataset.date;
    switch (b.dataset.cal) {
      case "gestion": ouvrirGestion(); break;
      case "fermer": fermerGestion(); break;
      case "rouvrir": if (RE_JOUR.test(d)) { changer(() => { cal.ouverts[d] = 1; }); toast("🔓 Jour ouvert exceptionnellement"); } break;
      case "refermer": if (RE_JOUR.test(d)) changer(() => { cal.ouverts[d] = 0; }); break;
      case "retirerConge": if (RE_CONGE.test(b.dataset.cle)) changer(() => { cal.conges[b.dataset.cle] = 0; }); break;
      case "ajouterConge": ajouterConge(); break;
      case "ouvrirJour": ouvrirJour(); break;
    }
  });

  return {
    CLE_SERVEUR: CLE_SERVEUR,
    etat: etat,
    bandeau: bandeau,
    recevoir: recevoir,
    pourServeur: pourServeur,
    surChangement: (f) => abonnes.push(f),
    ouvrirGestion: ouvrirGestion,
  };
})();
