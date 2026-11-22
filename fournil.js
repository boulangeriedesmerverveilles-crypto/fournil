const SYNC = {
  url: "https://www.boulangeriedesmerveilles.fr/wp-json/bdm-fournil/v1/data",
  jeton: "6dff0ba76a6012c1b408b8cd474da23d41d538f5ec17b636",
};
const CLE_ATTENTE = "bdm_fournil_attente";
const MOMENT = "Jour"; // un seul relevé quotidien
// Frigos 1 à 7 : froid positif 0/+4 °C. N°8 et 9 : congélateurs négatifs. N°10 : chambre froide négative. (-30/-18 °C)
const NEG = { min: -30, max: -18, defaut: -19 };
const FRIGOS = [
  ...Array.from({ length: 7 }, (_, i) => ({
    id: "f" + (i + 1), num: i + 1, nom: "Frigo " + (i + 1), min: 0, max: 4, defaut: 3,
  })),
  { id: "f8",  num: 8,  nom: "Congel 1", ...NEG },
  { id: "f9",  num: 9,  nom: "Congel 2", ...NEG },
  { id: "f10", num: 10, nom: "Chambre froide négative", ...NEG },
];
const CLE = "bdm_fournil_v1";
const MOIS_FR = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

/* ---------- Sécurité : on ne fait confiance ni au serveur ni au stockage local ---------- */
function echapper(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
/** Ne garde que la forme attendue : dates, températures chiffrées, arrêts, et « relevé validé » (sans heure ni nom).
    Tout le reste est écarté, pour qu'une donnée trafiquée ne puisse jamais s'exécuter dans la page. */
// Jours retirés du registre à la demande d'Isabelle (essais, pas de vrais relevés).
// Ils sont écartés ici pour qu'aucun téléphone qui en garde une copie ne les renvoie au serveur.
const JOURS_RETIRES = ["2026-06-13"];
function assainir(brut) {
  const propre = {};
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return propre;
  Object.keys(brut).forEach(date => {
    const src = brut[date];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !src || typeof src !== "object") return;
    if (JOURS_RETIRES.includes(date)) return;
    const jour = {};
    FRIGOS.forEach(f => {
      const r = src[f.id];
      if (!r || typeof r !== "object") return;
      const net = {};
      if (r.off === true) net.off = true;
      if (typeof r[MOMENT] === "number" && isFinite(r[MOMENT])) net[MOMENT] = r[MOMENT];
      if (Object.keys(net).length) jour[f.id] = net;
    });
    const v = src._v && src._v[MOMENT];
    if (v && typeof v === "object") {
      jour._v = {};
      jour._v[MOMENT] = { ok: true }; // l'heure et le nom des anciens relevés ne sont plus repris
    }
    if (Object.keys(jour).length) propre[date] = jour;
  });
  return propre;
}

let donnees;
try { donnees = assainir(JSON.parse(localStorage.getItem(CLE) || "{}")); } catch (e) { donnees = {}; }
// { "2026-06-13": { f1:{Jour:3}, f5:{off:true}, _v:{ Jour:{ok:true} } } }
let modeRecap = false;
const $ = id => document.getElementById(id);

function aujourdhui() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function dateFr(iso) {
  const [a,m,j] = iso.split("-");
  return parseInt(j) + " " + MOIS_FR[parseInt(m)-1] + " " + a;
}
function fmtTemp(v) { return (v > 0 ? "+" : "") + String(v).replace(".", ","); }
function conforme(f, v) { return v >= f.min && v <= f.max; }
function jourCourant() { return donnees[$("dateJour").value] || {}; }

/* ---------- SAISIE ---------- */
/** Vrai si le jour affiché est fermé ET ne contient encore aucune saisie. */
function jourFerme() {
  return Calendrier.bandeau($("dateJour").value, Object.keys(jourCourant()).length > 0, "relevé").ferme;
}

function rendreSaisie() {
  const jour = jourCourant();
  const fermeture = Calendrier.bandeau($("dateJour").value, Object.keys(jour).length > 0, "relevé");
  $("bandeauFerme").innerHTML = fermeture.html; // HTML fabriqué et échappé par calendrier.js
  $("bandeauFerme").hidden = !fermeture.html;
  if (fermeture.ferme) {
    $("listeFrigos").innerHTML = "";
    $("bandeauAlerte").style.display = "none";
    majStatut();
    majBoutonValider();
    return;
  }
  $("listeFrigos").innerHTML = FRIGOS.map(f => {
    const off = !!(jour[f.id] && jour[f.id].off);
    const v = !off && jour[f.id] && jour[f.id][MOMENT] !== undefined ? jour[f.id][MOMENT] : "";
    return `
    <div class="frigo ${off ? "eteint" : ""}" id="frigo_${f.id}">
      <div class="entete-f">
        <div class="num">${f.num}</div>
        <div class="infos">
          <h2>${f.nom}</h2>
          <div class="plage">${fmtTemp(f.min)} à ${fmtTemp(f.max)} °C</div>
        </div>
        <div class="toggle ${off ? "off" : ""}" onclick="basculerOff('${f.id}')" role="switch" aria-checked="${!off}" aria-label="Marche/Arrêt ${f.nom}">
          <div class="piste"><div class="rond"></div></div>
          <div class="etiq">${off ? "Arrêt" : "Marche"}</div>
        </div>
      </div>
      <div class="stepper">
        <button onclick="bouger('${f.id}',-0.5)" ${off ? "disabled" : ""}>−</button>
        <input type="number" inputmode="decimal" step="0.5" id="t_${f.id}" value="${v}"
               placeholder="—" ${off ? "disabled" : ""} onchange="majClasse(this,'${f.id}')">
        <button onclick="bouger('${f.id}',0.5)" ${off ? "disabled" : ""}>+</button>
        <span class="deg">°C</span>
      </div>
    </div>`;
  }).join("");
  FRIGOS.forEach(f => majClasse($("t_" + f.id), f.id));
  majStatut();
  majBoutonValider();
}

function majBoutonValider() {
  const v = jourCourant()._v || {};
  const b = $("btnValider");
  b.disabled = jourFerme();
  if (b.disabled) { b.classList.remove("valide"); b.textContent = "🔒 Jour de fermeture"; return; }
  if (v[MOMENT]) { b.classList.add("valide"); b.textContent = "✓ Relevé validé — revalider ?"; }
  else { b.classList.remove("valide"); b.textContent = "✓ Valider le relevé"; }
}

function majStatut() {
  const v = jourCourant()._v || {};
  const s = $("statutValide");
  if (v[MOMENT]) {
    s.style.display = "block";
    s.textContent = "✓ Relevé validé";
  } else s.style.display = "none";
}

function bouger(fid, delta) {
  const f = FRIGOS.find(x => x.id === fid);
  const inp = $("t_" + fid);
  let v = inp.value === "" ? f.defaut : Math.round((parseFloat(inp.value) + delta) * 10) / 10;
  inp.value = v;
  majClasse(inp, fid);
}

function majClasse(inp, fid) {
  if (!inp) return;
  const f = FRIGOS.find(x => x.id === fid);
  inp.classList.remove("ok", "alerte");
  if (inp.value !== "" && !inp.disabled) {
    inp.classList.add(conforme(f, parseFloat(inp.value)) ? "ok" : "alerte");
  }
  majBandeau();
}

function majBandeau() {
  const pb = [];
  FRIGOS.forEach(f => {
    const inp = $("t_" + f.id);
    if (inp && !inp.disabled && inp.value !== "" && !conforme(f, parseFloat(inp.value))) pb.push(f.nom);
  });
  const b = $("bandeauAlerte");
  if (pb.length) {
    b.style.display = "block";
    b.textContent = "⚠️ Température hors plage : " + pb.join(", ") + ". Vérifiez l'équipement et notez l'action corrective.";
  } else b.style.display = "none";
}

function basculerOff(fid) {
  const date = $("dateJour").value;
  donnees[date] = donnees[date] || {};
  const jour = donnees[date];
  const off = !(jour[fid] && jour[fid].off);
  if (off) jour[fid] = { off: true };
  else delete jour[fid];
  if (Object.keys(jour).length === 0) delete donnees[date];
  localStorage.setItem(CLE, JSON.stringify(donnees));
  if (off) pushServeur({ [date]: { [fid]: { off: true } } });
  rendreSaisie();
}

function valider() {
  const date = $("dateJour").value;
  if (!date || jourFerme()) return;
  donnees[date] = donnees[date] || {};
  const jour = donnees[date];
  let n = 0;
  FRIGOS.forEach(f => {
    if (jour[f.id] && jour[f.id].off) { n++; return; }
    const val = $("t_" + f.id).value;
    if (val !== "") {
      jour[f.id] = jour[f.id] || {};
      jour[f.id][MOMENT] = parseFloat(val);
      n++;
    } else if (jour[f.id]) {
      delete jour[f.id][MOMENT];
      if (jour[f.id][MOMENT] === undefined && !jour[f.id].off) delete jour[f.id];
    }
  });
  if (n === 0) { toast("Saisissez d'abord les températures (ou mettez les frigos éteints sur Off)"); return; }
  const manquants = FRIGOS.filter(f => !(jour[f.id] && (jour[f.id].off || jour[f.id][MOMENT] !== undefined)));
  jour._v = jour._v || {};
  jour._v[MOMENT] = { ok: true };
  localStorage.setItem(CLE, JSON.stringify(donnees));
  pushServeur({ [date]: donnees[date] });
  majStatut();
  majBoutonValider();
  toast("✓ Relevé validé" +
    (manquants.length ? " — attention, sans : " + manquants.map(f => f.nom).join(", ") : ""));
}

function changerJour(delta) {
  const d = new Date($("dateJour").value + "T12:00:00");
  d.setDate(d.getDate() + delta);
  $("dateJour").value = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  rendreSaisie();
}

/* ---------- RÉCAP ---------- */
function listerMois() {
  const set = new Set(Object.keys(donnees).map(d => d.slice(0,7)));
  set.add(aujourdhui().slice(0,7));
  return [...set].sort().reverse();
}
function rendreSelectMois() {
  $("selMois").innerHTML = listerMois().map(m => {
    const [a, mo] = m.split("-");
    const n = MOIS_FR[parseInt(mo)-1];
    return `<option value="${m}">${n.charAt(0).toUpperCase()+n.slice(1)} ${a}</option>`;
  }).join("");
}

function statsMois(mois) {
  const jours = Object.keys(donnees).filter(d => d.startsWith(mois)).sort();
  const stats = {};
  FRIGOS.forEach(f => stats[f.id] = { n: 0, min: null, max: null, alertes: 0 });
  jours.forEach(date => FRIGOS.forEach(f => {
    const r = donnees[date][f.id];
    if (!r || r.off || r[MOMENT] === undefined) return;
    const s = stats[f.id], v = r[MOMENT];
    s.n++;
    s.min = s.min === null ? v : Math.min(s.min, v);
    s.max = s.max === null ? v : Math.max(s.max, v);
    if (!conforme(f, v)) s.alertes++;
  }));
  return { jours, stats };
}

function rendreRecap() {
  const mois = $("selMois").value;
  const { jours, stats } = statsMois(mois);
  if (jours.length === 0) {
    // Même sans aucun relevé, on montre le contrôle : c'est là qu'on voit les jours manquants.
    $("listeRecap").innerHTML = `<div class="vide">Aucun relevé enregistré ce mois-ci.</div>${rendreControle(mois)}`;
    return;
  }
  $("listeRecap").innerHTML = `
    <div class="recap-stats">
      <h2>${jours.length} jour(s) de relevés</h2>
      <table>
        <tr><th>Frigo</th><th>Relevés</th><th>Mini</th><th>Maxi</th><th>Alertes</th></tr>
        ${FRIGOS.map(f => {
          const s = stats[f.id];
          return `<tr><td>${f.nom}</td><td>${s.n}</td>
            <td>${s.min === null ? "—" : fmtTemp(s.min) + " °C"}</td>
            <td>${s.max === null ? "—" : fmtTemp(s.max) + " °C"}</td>
            <td class="${s.alertes ? "nb-alertes" : ""}">${s.alertes || "0"}</td></tr>`;
        }).join("")}
      </table>
    </div>
    ${rendreControle(mois)}`;
}

/* ---------- CONTRÔLE MANAGER ---------- */
function rendreControle(mois) {
  const [annee, m] = mois.split("-").map(Number);
  const dernierJour = new Date(annee, m, 0).getDate();
  const ajd = aujourdhui();
  const lignes = [];
  let manques = 0;
  for (let j = 1; j <= dernierJour; j++) {
    const date = mois + "-" + String(j).padStart(2, "0");
    const futur = date > ajd;
    const jour = donnees[date] || {};
    const v = jour._v || {};
    let alertes = 0;
    FRIGOS.forEach(f => {
      const r = jour[f.id];
      if (!r || r.off || r[MOMENT] === undefined) return;
      if (!conforme(f, r[MOMENT])) alertes++;
    });
    let cell;
    if (v[MOMENT]) cell = `<td class="ok">✓ fait</td>`;
    else if (Calendrier.etat(date).ferme) cell = `<td class="futur">fermé</td>`;
    else if (futur) cell = `<td class="futur">·</td>`;
    else { manques++; cell = `<td class="manque">✗ manquant</td>`; }
    lignes.push(`<tr class="${alertes ? "alerte-jour" : ""}">
      <td>${String(j).padStart(2,"0")}/${String(m).padStart(2,"0")}${alertes ? " ⚠️" : ""}</td>${cell}
    </tr>`);
  }
  return `
    <div class="recap-stats controle">
      <h2>👔 Contrôle manager — relevés du mois</h2>
      <table>
        <tr><th>Jour</th><th>Relevé</th></tr>
        ${lignes.join("")}
      </table>
      <div class="legende">
        ${manques === 0
          ? "✓ Tous les relevés sont faits jusqu'à aujourd'hui."
          : "✗ " + manques + " relevé(s) manquant(s) ce mois-ci."}
        — « fermé » = mercredi, jeudi ou congés. ⚠️ = température hors plage ce jour-là (détail en rouge dans le PDF).
      </div>
    </div>`;
}

/* ---------- PDF ---------- */
function nomMois(mois) {
  const [a, m] = mois.split("-");
  const n = MOIS_FR[parseInt(m)-1];
  return n.charAt(0).toUpperCase() + n.slice(1) + " " + a;
}

function genererPdfMois() {
  const mois = $("selMois").value;
  const { jours, stats } = statsMois(mois);
  if (jours.length === 0) { toast("Aucun relevé ce mois-ci"); return; }

  const doc = new jspdf.jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.setTextColor(93, 70, 50);
  doc.text("Boulangerie des Merveilles — Fournil", 14, 14);
  doc.setFontSize(11);
  doc.setTextColor(154, 90, 59);
  doc.text("Registre HACCP — Relevé des températures — " + nomMois(mois), 14, 21);
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text("Frigos 1 à 7 : froid positif 0 à +4 °C.   |   Congel 1, Congel 2 et Chambre froide négative : -30 à -18 °C.", 14, 27);

  const head = [["Date", ...FRIGOS.map(f => f.num <= 7 ? "F" + f.num : f.nom), "Relevé"]];
  const body = jours.map(date => {
    const v = donnees[date]._v || {};
    return [dateFr(date).replace(" " + mois.slice(0,4), ""),
      ...FRIGOS.map(f => {
        const r = donnees[date][f.id];
        if (r && r.off) return "Éteint";
        return r && r[MOMENT] !== undefined ? fmtTemp(r[MOMENT]) : "—";
      }),
      v[MOMENT] ? "validé" : "—"];
  });

  doc.autoTable({
    startY: 31,
    head, body,
    theme: "grid",
    headStyles: { fillColor: [154, 90, 59], fontSize: 8, halign: "center" },
    styles: { fontSize: 8, halign: "center", cellPadding: 1.5 },
    columnStyles: { 0: { halign: "left", cellWidth: 26 } },
    didParseCell: d => {
      if (d.section !== "body" || d.column.index === 0) return;
      if (d.column.index > FRIGOS.length) { d.cell.styles.fontSize = 7; return; } // colonne visa
      const f = FRIGOS[d.column.index - 1];
      const txt = d.cell.raw;
      if (txt === "Éteint") { d.cell.styles.textColor = [150, 150, 150]; d.cell.styles.fontStyle = "italic"; return; }
      if (txt === "—") return;
      const v = parseFloat(String(txt).replace(",", ".").replace("+", ""));
      if (!conforme(f, v)) {
        d.cell.styles.textColor = [192, 57, 43];
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = [253, 236, 234];
      }
    },
  });

  let y = doc.lastAutoTable.finalY + 8;
  const totalAlertes = FRIGOS.reduce((t, f) => t + stats[f.id].alertes, 0);
  doc.setFontSize(9);
  doc.setTextColor(93, 70, 50);
  doc.text("Synthèse : " + jours.length + " jour(s) de relevés — " +
    (totalAlertes === 0 ? "aucune température hors plage." : totalAlertes + " relevé(s) hors plage (en rouge ci-dessus)."), 14, y);
  y += 10;
  doc.text("Date : ______________________        Signature du responsable : ______________________", 14, y);

  doc.save("Temperatures_Fournil_HACCP_" + mois + ".pdf");
}

/* ---------- SYNCHRONISATION ---------- */
function majSync(ok) {
  $("etatSync").textContent = ok ? "🟢" : "🔴";
  $("etatSync").title = ok ? "Synchronisé avec le serveur" : "Hors ligne — sera synchronisé au prochain accès internet";
}

function appliquerServeur(srv) {
  if (!srv || Array.isArray(srv) || typeof srv !== "object") srv = {};
  Calendrier.recevoir(srv[Calendrier.CLE_SERVEUR]); // fermetures et congés, rangés à part du registre
  srv = assainir(srv);
  let aPousser = false;
  Object.keys(donnees).forEach(d => { if (!srv[d]) { srv[d] = donnees[d]; aPousser = true; } });
  donnees = srv;
  localStorage.setItem(CLE, JSON.stringify(donnees));
  return aPousser;
}

function urlSync(payload) {
  let u = SYNC.url + "?t=" + encodeURIComponent(SYNC.jeton);
  if (payload) u += "&push=" + encodeURIComponent(JSON.stringify(payload));
  return u;
}

async function pullServeur() {
  try {
    const r = await fetch(urlSync());
    if (!r.ok) throw new Error(r.status);
    const aPousser = appliquerServeur(await r.json());
    majSync(true);
    if (aPousser || localStorage.getItem(CLE_ATTENTE)) await pushServeur();
    if (modeRecap) { rendreSelectMois(); rendreRecap(); } else rendreSaisie();
  } catch (e) {
    majSync(false);
  }
}

async function pushServeur(payload) {
  if (!payload) { payload = Object.assign({}, donnees); payload[Calendrier.CLE_SERVEUR] = Calendrier.pourServeur(); }
  try {
    const r = await fetch(urlSync(payload));
    if (!r.ok) throw new Error(r.status);
    appliquerServeur(await r.json());
    localStorage.removeItem(CLE_ATTENTE);
    majSync(true);
  } catch (e) {
    localStorage.setItem(CLE_ATTENTE, "1");
    majSync(false);
  }
}

/* ---------- NAVIGATION ---------- */
function basculer() {
  modeRecap = !modeRecap;
  $("vueSaisie").style.display = modeRecap ? "none" : "block";
  $("vueRecap").style.display = modeRecap ? "block" : "none";
  $("btnRecap").textContent = modeRecap ? "✏️" : "📊";
  $("btnValider").style.display = modeRecap ? "none" : "block";
  $("btnRecap").style.flex = modeRecap ? "1" : "0 0 64px";
  if (modeRecap) { rendreSelectMois(); rendreRecap(); pullServeur(); }
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 3000);
}

$("dateJour").value = aujourdhui();
$("dateJour").addEventListener("change", rendreSaisie);
$("jourPrec").addEventListener("click", () => changerJour(-1));
$("jourSuiv").addEventListener("click", () => changerJour(1));
$("btnValider").addEventListener("click", valider);
$("btnRecap").addEventListener("click", basculer);
$("selMois").addEventListener("change", rendreRecap);
$("btnPdfMois").addEventListener("click", genererPdfMois);
Calendrier.surChangement(() => { if (modeRecap) rendreRecap(); else rendreSaisie(); });
rendreSaisie();
pullServeur();
document.addEventListener("visibilitychange", () => { if (!document.hidden) pullServeur(); });
