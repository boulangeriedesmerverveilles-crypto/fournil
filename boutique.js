/* ============================================================
   Module « Températures boutique » (les vitrines et le frigo des vendeuses)

   Reprend l'ancienne appli séparée (adresse /frigos/) : même serveur, même
   registre, même mémoire dans le téléphone (clé bdm_frigos_v1). Deux relevés
   par jour, le matin et le soir, validés séparément.

   Par rapport à l'ancienne appli : plus de prénom ni d'heure de validation,
   jours de fermeture grisés, action corrective en cas de température hors plage.

   Dépend de fournil.js ($, toast, echapper, fmtTemp, conforme, dateFr, MOIS_FR,
   aujourdhui, ACTIONS, textePdf, nomMois), de calendrier.js et de jsPDF.
   ============================================================ */
const Boutique = (() => {
  "use strict";

  const SYNC_B = {
    url: "https://www.boulangeriedesmerveilles.fr/wp-json/bdm-frigos/v1/data",
    jeton: "31bf87011bfba9b6eb857d56426476fc18746b496a2c034f",
  };
  const CLE_B = "bdm_frigos_v1";
  const CLE_ATTENTE_B = "bdm_frigos_attente"; // jours à renvoyer au serveur (ancienne appli : simple « 1 »)
  const MOMENTS = ["Matin", "Soir"];
  const EQUIP = [
    { id: "vitrine_salee", num: 1, nom: "Vitrine salée", court: "Vitrine salée", min: 0, max: 4, defaut: 3 },
    { id: "vitrine_patis", num: 2, nom: "Vitrine pâtissière", court: "Vitrine pâtissière", min: 0, max: 4, defaut: 3 },
    { id: "frigo_reserve", num: 3, nom: "Frigo de réserve", court: "Frigo de réserve", min: 0, max: 4, defaut: 3 },
    { id: "vitrine_neg", num: 4, nom: "Vitrine froid négatif 1 (Hibernat)", court: "Vitrine négatif 1", min: -30, max: -18, defaut: -19 },
    // Ajoutée le 22/11/2026 : les jours antérieurs n'ont pas de relevé pour elle (affichés « — »).
    { id: "vitrine_neg2", num: 5, nom: "Vitrine froid négatif 2 (Hibernat)", court: "Vitrine négatif 2", min: -30, max: -18, defaut: -19 },
  ];

  /* ---------- Filtre : on ne garde que la forme attendue ---------- */
  function assainirB(brut) {
    const propre = {};
    if (!brut || typeof brut !== "object" || Array.isArray(brut)) return propre;
    Object.keys(brut).forEach((date) => {
      const src = brut[date];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !src || typeof src !== "object") return;
      const jour = {};
      EQUIP.forEach((e) => {
        const r = src[e.id];
        if (!r || typeof r !== "object") return;
        const net = {};
        if (r.off === true) net.off = true;
        MOMENTS.forEach((m) => { if (typeof r[m] === "number" && isFinite(r[m])) net[m] = r[m]; });
        if (Object.keys(net).length) jour[e.id] = net;
      });
      const v = src._v;
      if (v && typeof v === "object") {
        MOMENTS.forEach((m) => {
          if (v[m] && typeof v[m] === "object") { jour._v = jour._v || {}; jour._v[m] = { ok: true }; } // ni heure ni prénom
        });
      }
      const a = src._a;
      if (a && typeof a === "object") {
        const net = {};
        MOMENTS.forEach((m) => {
          if (typeof a[m] === "string" && a[m].trim()) net[m] = a[m].trim().slice(0, 300);
          if (typeof a["c_" + m] === "string") {
            const codes = a["c_" + m].split(",").filter((c) => ACTIONS.some((x) => x.code === c));
            if (codes.length) net["c_" + m] = codes.join(",");
          }
        });
        if (Object.keys(net).length) jour._a = net;
      }
      if (Object.keys(jour).length) propre[date] = jour;
    });
    return propre;
  }

  /* ---------- État ---------- */
  let donnees;
  try { donnees = assainirB(JSON.parse(localStorage.getItem(CLE_B) || "{}")); } catch (e) { donnees = {}; }
  let moment = new Date().getHours() < 14 ? "Matin" : "Soir";
  let modeRecap = false;
  let pret = false;
  let saisieEnCours = false; // des valeurs ont été tapées et pas encore validées : on ne rafraîchit pas l'écran par-dessus
  let brouillon = { cle: "", texte: "", cases: [] };

  const garder = () => { try { localStorage.setItem(CLE_B, JSON.stringify(donnees)); } catch (e) {} };
  const actif = () => document.body.dataset.module === "boutique";
  const dateVue = () => {
    const c = $("b_date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.value)) c.value = aujourdhui();
    return c.value;
  };
  const jourVu = () => donnees[dateVue()] || {};
  const libelle = (m) => (m === "Matin" ? "le matin" : "le soir");
  const fait = (jour, m) => !!(jour && jour._v && jour._v[m]);

  /* ---------- Action corrective (par moment) ---------- */
  const casesDe = (jour, m) => (jour && jour._a && jour._a["c_" + m] ? jour._a["c_" + m].split(",") : []);
  const precisionsDe = (jour, m) => (jour && jour._a && jour._a[m]) || "";
  function actionDe(jour, m) {
    const morceaux = ACTIONS.filter((a) => casesDe(jour, m).includes(a.code)).map((a) => a.texte);
    if (precisionsDe(jour, m)) morceaux.push(precisionsDe(jour, m));
    return morceaux.join(" · ");
  }
  const horsPlageDe = (jour, m) => EQUIP.filter((e) => jour && jour[e.id] && !jour[e.id].off
    && jour[e.id][m] !== undefined && !conforme(e, jour[e.id][m])).length;
  const casesCochees = () => [...document.querySelectorAll("#b_cases input:checked")].map((i) => i.value);

  /* ---------- Saisie ---------- */
  function fermeture() {
    return Calendrier.bandeau(dateVue(), Object.keys(jourVu()).length > 0, "relevé");
  }

  function rendreSaisie() {
    const date = dateVue();
    const jour = jourVu();
    const f = fermeture();
    saisieEnCours = false;
    $("b_ferme").innerHTML = f.html; // HTML fabriqué et échappé par calendrier.js
    $("b_ferme").hidden = !f.html;
    document.querySelectorAll("#b_onglets button").forEach((b) => {
      const m = b.dataset.moment;
      b.classList.toggle("actif", m === moment);
      b.classList.toggle("fait", fait(jour, m));
      b.querySelector("span").textContent = fait(jour, m) ? "✓ validé" : "à faire";
    });
    $("b_onglets").hidden = f.ferme;
    if (f.ferme) {
      $("b_liste").innerHTML = "";
      $("b_zoneAction").hidden = true;
      $("b_alerte").style.display = "none";
      majStatutEtBouton();
      return;
    }
    $("b_liste").innerHTML = EQUIP.map((e, i) => {
      const off = !!(jour[e.id] && jour[e.id].off);
      const v = !off && jour[e.id] && jour[e.id][moment] !== undefined ? jour[e.id][moment] : "";
      return `
      <div class="frigo ${off ? "eteint" : ""}" data-e="${i}">
        <div class="entete-f">
          <div class="num">${e.num}</div>
          <div class="infos">
            <h2>${e.nom}</h2>
            <div class="plage">${fmtTemp(e.min)} à ${fmtTemp(e.max)} °C</div>
          </div>
          <div class="toggle ${off ? "off" : ""}" data-act="bascule" role="switch" aria-checked="${!off}" aria-label="Marche/Arrêt ${e.nom}">
            <div class="piste"><div class="rond"></div></div>
            <div class="etiq">${off ? "Arrêt" : "Marche"}</div>
          </div>
        </div>
        <div class="stepper">
          <button type="button" data-act="moins" ${off ? "disabled" : ""}>−</button>
          <input type="number" inputmode="decimal" step="0.5" id="b_t_${e.id}" value="${v}" placeholder="—" ${off ? "disabled" : ""} aria-label="Température ${e.nom}">
          <button type="button" data-act="plus" ${off ? "disabled" : ""}>+</button>
          <span class="deg">°C</span>
        </div>
      </div>`;
    }).join("");
    const cle = date + "|" + moment;
    const enBrouillon = brouillon.cle === cle;
    const cochees = enBrouillon ? brouillon.cases : casesDe(jour, moment);
    $("b_cases").innerHTML = ACTIONS.map((a) =>
      `<label><input type="checkbox" value="${a.code}"${cochees.includes(a.code) ? " checked" : ""}> ${a.texte}</label>`).join("");
    $("b_action").value = enBrouillon ? brouillon.texte : precisionsDe(jour, moment);
    EQUIP.forEach((e) => majClasse($("b_t_" + e.id), e));
    majAlerte();
    majStatutEtBouton();
  }

  function majClasse(champ, e) {
    if (!champ) return;
    champ.classList.remove("ok", "alerte");
    if (champ.value !== "" && !champ.disabled) champ.classList.add(conforme(e, parseFloat(champ.value)) ? "ok" : "alerte");
  }

  function majAlerte() {
    const pb = EQUIP.filter((e) => {
      const c = $("b_t_" + e.id);
      return c && !c.disabled && c.value !== "" && !conforme(e, parseFloat(c.value));
    }).map((e) => e.nom);
    const b = $("b_alerte");
    if (pb.length) {
      b.style.display = "block";
      b.textContent = "⚠️ Température hors plage : " + pb.join(", ") + ". Vérifiez l'équipement et notez l'action corrective ci-dessous.";
    } else b.style.display = "none";
    $("b_zoneAction").hidden = !(pb.length || $("b_action").value.trim() || casesCochees().length);
  }

  function majStatutEtBouton() {
    const jour = jourVu();
    const ferme = fermeture().ferme;
    const s = $("b_statut");
    const b = $("b_valider");
    b.disabled = ferme;
    if (ferme) {
      s.style.display = "none";
      b.classList.remove("valide");
      b.textContent = "🔒 Jour de fermeture";
      return;
    }
    if (fait(jour, moment)) {
      s.style.display = "block";
      s.textContent = "✓ Relevé du " + moment.toLowerCase() + " validé";
      b.classList.add("valide");
      b.textContent = "✓ " + moment + " validé — revalider ?";
    } else {
      s.style.display = "none";
      b.classList.remove("valide");
      b.textContent = "✓ Valider " + libelle(moment);
    }
  }

  function surClicListe(ev) {
    const cible = ev.target.closest("[data-act]");
    if (!cible) return;
    const carte = cible.closest(".frigo");
    const e = EQUIP[+carte.dataset.e];
    if (cible.dataset.act === "bascule") { basculer(e); return; }
    const champ = $("b_t_" + e.id);
    const delta = cible.dataset.act === "plus" ? 0.5 : -0.5;
    champ.value = champ.value === "" ? e.defaut : Math.round((parseFloat(champ.value) + delta) * 10) / 10;
    saisieEnCours = true;
    majClasse(champ, e);
    majAlerte();
  }

  /** Marche/Arrêt d'un équipement pour la journée entière (matin et soir). */
  function basculer(e) {
    const date = dateVue();
    donnees[date] = donnees[date] || {};
    const jour = donnees[date];
    const off = !(jour[e.id] && jour[e.id].off);
    if (off) jour[e.id] = { off: true };
    else delete jour[e.id];
    if (!Object.keys(jour).length) delete donnees[date];
    garder();
    if (off) { const envoi = {}; envoi[date] = {}; envoi[date][e.id] = { off: true }; pousser(envoi); }
    rendreSaisie();
  }

  function valider() {
    const date = dateVue();
    if (fermeture().ferme) return;
    donnees[date] = donnees[date] || {};
    const jour = donnees[date];
    let n = 0;
    EQUIP.forEach((e) => {
      if (jour[e.id] && jour[e.id].off) { n++; return; }
      const val = $("b_t_" + e.id).value;
      if (val !== "") {
        jour[e.id] = jour[e.id] || {};
        jour[e.id][moment] = parseFloat(val);
        n++;
      } else if (jour[e.id]) {
        delete jour[e.id][moment];
        if (!MOMENTS.some((m) => jour[e.id][m] !== undefined)) delete jour[e.id];
      }
    });
    if (n === 0) {
      if (!Object.keys(jour).length) delete donnees[date];
      toast("Saisissez d'abord les températures (ou mettez les équipements éteints sur Arrêt)");
      return;
    }
    const manquants = EQUIP.filter((e) => !(jour[e.id] && (jour[e.id].off || jour[e.id][moment] !== undefined)));
    jour._v = jour._v || {};
    jour._v[moment] = { ok: true };

    const precisions = $("b_action").value.trim().slice(0, 300);
    const codes = casesCochees().join(",");
    jour._a = jour._a || {};
    if (precisions) jour._a[moment] = precisions; else delete jour._a[moment];
    if (codes) jour._a["c_" + moment] = codes; else delete jour._a["c_" + moment];
    if (!Object.keys(jour._a).length) delete jour._a;
    // Le serveur ne sait qu'ajouter : on envoie toujours les deux champs du moment, même vides, pour remplacer les anciens.
    const envoiJour = Object.assign({}, jour);
    envoiJour._a = Object.assign({}, jour._a || {});
    envoiJour._a[moment] = precisions;
    envoiJour._a["c_" + moment] = codes;
    const envoi = {};
    envoi[date] = envoiJour;

    brouillon = { cle: "", texte: "", cases: [] };
    saisieEnCours = false;
    garder();
    pousser(envoi);
    rendreSaisie();
    toast("✓ Relevé du " + moment.toLowerCase() + " validé" +
      (manquants.length ? " — attention, sans : " + manquants.map((e) => e.nom).join(", ") : "") +
      (horsPlageDe(jour, moment) && !actionDe(jour, moment) ? " — pensez à noter l'action corrective" : ""));
  }

  function changerJour(n) {
    const d = new Date(dateVue() + "T12:00:00");
    d.setDate(d.getDate() + n);
    $("b_date").value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    rendreSaisie();
  }

  /* ---------- Récap, contrôle manager ---------- */
  function listerMois() {
    const mois = new Set(Object.keys(donnees).map((d) => d.slice(0, 7)));
    mois.add(aujourdhui().slice(0, 7));
    return [...mois].sort().reverse();
  }

  function rendreSelectMois() {
    const choisi = $("b_selMois").value;
    $("b_selMois").innerHTML = listerMois().map((m) => `<option value="${m}"${m === choisi ? " selected" : ""}>${nomMois(m)}</option>`).join("");
  }

  function statsMois(mois) {
    const jours = Object.keys(donnees).filter((d) => d.startsWith(mois)).sort();
    const stats = {};
    EQUIP.forEach((e) => { stats[e.id] = { n: 0, min: null, max: null, alertes: 0 }; });
    jours.forEach((date) => EQUIP.forEach((e) => {
      const r = donnees[date][e.id];
      if (!r || r.off) return;
      MOMENTS.forEach((m) => {
        if (r[m] === undefined) return;
        const s = stats[e.id], v = r[m];
        s.n++;
        s.min = s.min === null ? v : Math.min(s.min, v);
        s.max = s.max === null ? v : Math.max(s.max, v);
        if (!conforme(e, v)) s.alertes++;
      });
    }));
    return { jours: jours, stats: stats };
  }

  function rendreControle(mois) {
    const parts = mois.split("-").map(Number);
    const dernier = new Date(parts[0], parts[1], 0).getDate();
    const ajd = aujourdhui();
    const lignes = [];
    let manques = 0;
    for (let j = 1; j <= dernier; j++) {
      const date = mois + "-" + String(j).padStart(2, "0");
      const jour = donnees[date] || {};
      const ferme = Calendrier.etat(date).ferme;
      let alerteJour = false;
      const cellules = MOMENTS.map((m) => {
        const alertes = horsPlageDe(jour, m);
        if (alertes) alerteJour = true;
        const action = actionDe(jour, m);
        let detail = "";
        if (action) detail = `<div class="action-note">Action : ${echapper(action)}</div>`;
        else if (alertes) detail = `<div class="action-manque">Action corrective non notée</div>`;
        if (fait(jour, m)) return `<td class="ok">✓ fait${detail}</td>`;
        if (ferme) return `<td class="futur">fermé</td>`;
        if (date > ajd) return `<td class="futur">·</td>`;
        manques++;
        return `<td class="manque">✗ manquant</td>`;
      }).join("");
      lignes.push(`<tr class="${alerteJour ? "alerte-jour" : ""}">
        <td>${String(j).padStart(2, "0")}/${String(parts[1]).padStart(2, "0")}${alerteJour ? " ⚠️" : ""}</td>${cellules}</tr>`);
    }
    return `
      <div class="recap-stats controle">
        <h2>👔 Contrôle manager — relevés du mois</h2>
        <table>
          <tr><th>Jour</th><th>Matin</th><th>Soir</th></tr>
          ${lignes.join("")}
        </table>
        <div class="legende">
          ${manques === 0 ? "✓ Tous les relevés sont faits jusqu'à aujourd'hui." : "✗ " + manques + " relevé(s) manquant(s) ce mois-ci."}
          — « fermé » = mercredi, jeudi ou congés. ⚠️ = température hors plage ce jour-là (détail en rouge dans le PDF).
        </div>
      </div>`;
  }

  function rendreRecap() {
    const mois = $("b_selMois").value;
    const s = statsMois(mois);
    const tete = s.jours.length === 0
      ? `<div class="vide">Aucun relevé enregistré ce mois-ci.</div>`
      : `<div class="recap-stats">
          <h2>${s.jours.length} jour(s) de relevés</h2>
          <table>
            <tr><th>Équipement</th><th>Relevés</th><th>Mini</th><th>Maxi</th><th>Alertes</th></tr>
            ${EQUIP.map((e) => {
              const x = s.stats[e.id];
              return `<tr><td>${e.nom}</td><td>${x.n}</td>
                <td>${x.min === null ? "—" : fmtTemp(x.min) + " °C"}</td>
                <td>${x.max === null ? "—" : fmtTemp(x.max) + " °C"}</td>
                <td class="${x.alertes ? "nb-alertes" : ""}">${x.alertes || "0"}</td></tr>`;
            }).join("")}
          </table>
        </div>`;
    $("b_recap").innerHTML = tete + rendreControle(mois);
  }

  function basculerRecap() {
    modeRecap = !modeRecap;
    $("b_vueSaisie").hidden = modeRecap;
    $("b_vueRecap").hidden = !modeRecap;
    $("b_recapBtn").textContent = modeRecap ? "✏️" : "📊";
    $("b_valider").hidden = modeRecap;
    $("b_recapBtn").classList.toggle("large", modeRecap);
    if (modeRecap) { rendreSelectMois(); rendreRecap(); tirer(); } else rendreSaisie();
  }

  /* ---------- PDF du registre ---------- */
  function genererPdf() {
    const mois = $("b_selMois").value;
    const s = statsMois(mois);
    if (s.jours.length === 0) { toast("Aucun relevé ce mois-ci"); return; }
    const BLEU = [59, 122, 154], BRUN = [93, 70, 50], ROUGE = [192, 57, 43];
    const sansAnnee = (date) => dateFr(date).replace(" " + mois.slice(0, 4), "");

    const doc = new jspdf.jsPDF({ orientation: "landscape", compress: true });
    doc.setFontSize(16); doc.setTextColor(...BRUN);
    doc.text("Boulangerie des Merveilles — Boutique", 14, 14);
    doc.setFontSize(11); doc.setTextColor(...BLEU);
    doc.text("Registre HACCP — Relevé des températures — " + nomMois(mois), 14, 21);
    doc.setFontSize(8); doc.setTextColor(120, 120, 120);
    doc.text("Vitrine salée, vitrine pâtissière et frigo de réserve : 0 à +4 °C.   |   Vitrines froid négatif 1 et 2 (Hibernat) : -30 à -18 °C.", 14, 27);

    const head = [
      [{ content: "Date", rowSpan: 2 }, ...EQUIP.map((e) => ({ content: e.court, colSpan: 2 })), { content: "Relevé validé", colSpan: 2 }],
      [...EQUIP.flatMap(() => MOMENTS), ...MOMENTS],
    ];
    const body = s.jours.map((date) => {
      const jour = donnees[date];
      return [sansAnnee(date),
        ...EQUIP.flatMap((e) => MOMENTS.map((m) => {
          const r = jour[e.id];
          if (r && r.off) return "Éteint";
          return r && r[m] !== undefined ? fmtTemp(r[m]) : "—";
        })),
        ...MOMENTS.map((m) => (fait(jour, m) ? "oui" : "—"))];
    });
    doc.autoTable({
      startY: 31, head: head, body: body, theme: "grid",
      headStyles: { fillColor: BLEU, fontSize: 8, halign: "center", valign: "middle" },
      styles: { fontSize: 8, halign: "center", cellPadding: 1.5 },
      columnStyles: { 0: { halign: "left", cellWidth: 28 } },
      didParseCell: (c) => {
        if (c.section !== "body" || c.column.index === 0 || c.column.index > EQUIP.length * 2) return;
        const e = EQUIP[Math.floor((c.column.index - 1) / 2)];
        const txt = c.cell.raw;
        if (txt === "Éteint") { c.cell.styles.textColor = [150, 150, 150]; c.cell.styles.fontStyle = "italic"; return; }
        if (txt === "—") return;
        if (!conforme(e, parseFloat(String(txt).replace(",", ".").replace("+", "")))) {
          c.cell.styles.textColor = ROUGE; c.cell.styles.fontStyle = "bold"; c.cell.styles.fillColor = [253, 236, 234];
        }
      },
    });

    let y = doc.lastAutoTable.finalY + 8;
    const place = (h) => { if (y + h > 198) { doc.addPage(); y = 16; } };
    const concernes = [];
    s.jours.forEach((date) => MOMENTS.forEach((m) => {
      const action = actionDe(donnees[date], m);
      if (action || horsPlageDe(donnees[date], m)) concernes.push({ date: date, m: m, action: action });
    }));
    if (concernes.length) {
      place(12);
      doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...BRUN);
      doc.text("Actions correctives", 14, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      y += 5;
      concernes.forEach((c) => {
        const texte = sansAnnee(c.date) + ", " + c.m.toLowerCase() + " : " +
          (c.action ? textePdf(c.action) : "température hors plage — aucune action corrective notée.");
        const lignes = doc.splitTextToSize(texte, 268);
        place(lignes.length * 4 + 2);
        doc.setTextColor(...(c.action ? BRUN : ROUGE));
        doc.text(lignes, 14, y);
        y += lignes.length * 4 + 1.5;
      });
      y += 4;
    }
    place(18);
    const total = EQUIP.reduce((t, e) => t + s.stats[e.id].alertes, 0);
    doc.setFontSize(9); doc.setTextColor(...BRUN);
    doc.text("Synthèse : " + s.jours.length + " jour(s) de relevés — " +
      (total === 0 ? "aucune température hors plage." : total + " relevé(s) hors plage (en rouge ci-dessus)."), 14, y);
    y += 10;
    doc.text("Date : ______________________        Signature du responsable : ______________________", 14, y);
    doc.save("Temperatures_Boutique_HACCP_" + mois + ".pdf");
  }

  /* ---------- Synchronisation ---------- */
  function majSync(ok) {
    $("b_sync").textContent = ok ? "🟢" : "🔴";
    $("b_sync").title = ok ? "Synchronisé avec le serveur" : "Hors ligne — sera synchronisé au prochain accès internet";
  }

  function lireAttente() {
    try {
      const v = JSON.parse(localStorage.getItem(CLE_ATTENTE_B) || "[]");
      return Array.isArray(v) ? v.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : []; // « 1 » de l'ancienne appli → liste vide
    } catch (e) { return []; }
  }
  function ecrireAttente(dates) {
    const uniques = [...new Set(dates)];
    try {
      if (uniques.length) localStorage.setItem(CLE_ATTENTE_B, JSON.stringify(uniques));
      else localStorage.removeItem(CLE_ATTENTE_B);
    } catch (e) {}
  }

  const urlSync = (envoi) => SYNC_B.url + "?t=" + encodeURIComponent(SYNC_B.jeton)
    + (envoi ? "&push=" + encodeURIComponent(JSON.stringify(envoi)) : "");

  /** Remplace la copie locale par celle du serveur. Renvoie les jours présents seulement ici (saisis hors ligne). */
  function appliquer(srv) {
    srv = assainirB(srv);
    const locaux = Object.keys(donnees).filter((d) => !srv[d]);
    locaux.forEach((d) => { srv[d] = donnees[d]; });
    donnees = srv;
    garder();
    return locaux;
  }

  /** Envoie des jours au serveur, par petits paquets (l'envoi passe dans l'adresse : il doit rester court). */
  async function pousser(envoi) {
    const dates = Object.keys(envoi);
    try {
      for (let i = 0; i < dates.length; i += 4) {
        const paquet = {};
        dates.slice(i, i + 4).forEach((d) => { paquet[d] = envoi[d]; });
        const r = await fetch(urlSync(paquet));
        if (!r.ok) throw new Error(r.status);
        appliquer(await r.json());
        ecrireAttente(lireAttente().filter((d) => !paquet[d]));
      }
      majSync(true);
      return true;
    } catch (e) {
      ecrireAttente(lireAttente().concat(dates));
      majSync(false);
      return false;
    }
  }

  async function tirer() {
    try {
      const r = await fetch(urlSync());
      if (!r.ok) throw new Error(r.status);
      const aRenvoyer = [...new Set(appliquer(await r.json()).concat(lireAttente()))].filter((d) => donnees[d]);
      majSync(true);
      if (aRenvoyer.length) {
        const envoi = {};
        aRenvoyer.forEach((d) => { envoi[d] = donnees[d]; });
        await pousser(envoi);
      } else ecrireAttente([]);
      if (modeRecap) { rendreSelectMois(); rendreRecap(); }
      else if (!saisieEnCours) rendreSaisie(); // on ne rafraîchit pas par-dessus une saisie en cours
    } catch (e) {
      majSync(false);
    }
  }

  /* ---------- Démarrage ---------- */
  function demarrer() {
    $("b_date").value = aujourdhui();
    $("b_date").addEventListener("change", rendreSaisie);
    $("b_prec").addEventListener("click", () => changerJour(-1));
    $("b_suiv").addEventListener("click", () => changerJour(1));
    $("b_onglets").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-moment]");
      if (b) { moment = b.dataset.moment; rendreSaisie(); }
    });
    const liste = $("b_liste");
    liste.addEventListener("click", surClicListe);
    liste.addEventListener("input", (ev) => {
      const carte = ev.target.closest(".frigo");
      if (!carte) return;
      saisieEnCours = true;
      majClasse(ev.target, EQUIP[+carte.dataset.e]);
      majAlerte();
    });
    const noterBrouillon = () => {
      brouillon = { cle: dateVue() + "|" + moment, texte: $("b_action").value, cases: casesCochees() };
      saisieEnCours = true;
      majAlerte();
    };
    $("b_action").addEventListener("input", noterBrouillon);
    $("b_cases").addEventListener("change", noterBrouillon);
    $("b_valider").addEventListener("click", valider);
    $("b_recapBtn").addEventListener("click", basculerRecap);
    $("b_selMois").addEventListener("change", rendreRecap);
    $("b_pdf").addEventListener("click", genererPdf);

    Calendrier.surChangement(() => { if (modeRecap) rendreRecap(); else if (!saisieEnCours) rendreSaisie(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && actif()) tirer(); });
    rendreSaisie();
    tirer();
  }

  /** Appelé chaque fois que l'onglet Boutique devient visible. */
  function afficher() {
    if (!pret) { pret = true; demarrer(); } else tirer();
  }

  return { afficher: afficher };
})();
