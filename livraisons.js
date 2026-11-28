/* ============================================================
   Module « Livraisons de pain »

   Partage la base de l'appli Lovable « Merveilles Deliveries » :
   table Supabase public.deliveries (delivery_date, establishment, product, qty).
   Les deux applis lisent et écrivent les mêmes lignes ; les clients et
   produits y sont identifiés par leur NOM.

   Les listes (clients, produits cochés, tarifs) sont partagées entre les
   appareils : elles sont rangées sur le serveur des températures, dans un
   enregistrement réservé (voir CLE_PART), comme le calendrier des fermetures.
   Chaque appareil en garde une copie pour fonctionner hors ligne.

   Dépend de fournil.js pour $() et toast(), et de jsPDF + autoTable.
   ============================================================ */
const Livr = (() => {
  "use strict";

  /* ---------- Connexion (clé « publishable » : publique par conception) ---------- */
  const SB = {
    url: "https://lrxmcugcnbtajojxvybd.supabase.co/rest/v1/deliveries",
    cle: "sb_publishable_MRUp9jNeIpL4vKe6x7zM1w_hTBc5Uue",
  };
  const CHAMPS = "select=delivery_date,establishment,product,qty";
  const CLE_CFG = "bdm_livr_cfg_v1";   // clients, produits, tarifs (copie locale des listes partagées)
  const CLE_TAMP = "bdm_livr_cfg_t_v1"; // date du dernier changement connu de chaque liste
  const CLE_PART = "9999-12-30";       // enregistrement réservé aux listes sur le serveur des températures
  const CLE_DATA = "bdm_livr_data_v1"; // copie locale des livraisons
  const CLE_FILE = "bdm_livr_file_v1"; // saisies pas encore envoyées

  /* Listes de départ : celles de l'appli Lovable au 22/11/2026. */
  const BASE = ["Baguette", "Tradition", "Pain de campagne", "Pain complet", "Pain spécial"];
  const CFG_DEFAUT = {
    v: 1,
    prods: [...BASE, "Montagnard", "Croissant", "Restaurant", "Pain chocolat", "Ficelle /jocco", "Campagne",
      "Campaillettes", "Restaurant s/sel", "Pain bagnat", "Pain au noix", "Céréales", "Boules", "Blette sucre", "Myrtille"],
    ests: [
      { nom: "CHU", prods: [...BASE, "Restaurant s/sel", "Restaurant", "Pain bagnat"] },
      { nom: "Le Prieuré", prods: [...BASE, "Restaurant", "Céréales", "Croissant"] },
      { nom: "Collège", prods: [...BASE, "Restaurant"] },
      { nom: "Adapei", prods: ["Baguette"] },
      {
        nom: "Robby",
        prods: ["Baguette", "Montagnard", "Croissant", "Restaurant", "Pain chocolat", "Ficelle /jocco", "Campagne",
          "Campaillettes", "Pain au noix", "Boules", "Blette sucre", "Myrtille"],
        // Tarifs unitaires TTC repris de l'appli Lovable.
        prix: { "Baguette": 1.20, "Restaurant": 1.60, "Croissant": 1.30, "Pain chocolat": 1.30,
          "Ficelle /jocco": 0.80, "Campagne": 3.05, "Montagnard": 3.05, "Campaillettes": 1.40 },
      },
      { nom: "Le mirval", prods: ["Baguette"] },
    ],
    cachesEsts: [],
    cachesProds: [],
  };

  /* Ajouts du 28/11/2026 : la levure livrée au CHU (suivie auparavant dans l'ancien carnet « CHU-TRACKER »). */
  const AJOUTS = [{ prod: "Levure 500 g", est: "CHU" }];

  /* ---------- Petits outils ---------- */
  const lire = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const ecrire = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.error("livraisons : stockage", e); } };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const enc = encodeURIComponent;
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const deIso = (s) => { const [a, m, j] = s.split("-").map(Number); return new Date(a, m - 1, j, 12); };
  const dateLongue = (s) => deIso(s).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const dateCourte = (s) => { const [a, m, j] = s.split("-"); return j + "/" + m + "/" + a; };
  const dateLigne = (s) => deIso(s).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const moisTexte = (a, m0) => new Date(a, m0, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  // Montant en euros à partir de centimes. Les espaces insécables sont remplacés : le PDF ne sait pas les dessiner.
  const eur = (centimes) => (centimes / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ");
  const prixTexte = (v) => v.toFixed(2).replace(".", ",");
  const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const enLigne = () => navigator.onLine !== false;
  const actif = () => document.body.dataset.module === "livraisons";

  /* ---------- État ---------- */
  function normaliserCfg(c) {
    if (!c || c.v !== 1 || !Array.isArray(c.ests) || !Array.isArray(c.prods)) c = JSON.parse(JSON.stringify(CFG_DEFAUT));
    c.cachesEsts = c.cachesEsts || [];
    c.cachesProds = c.cachesProds || [];
    c.ests.forEach((e) => { e.prods = e.prods || []; e.prix = e.prix || {}; e.retires = e.retires || []; });
    // Produits apportés par une mise à jour : posés une seule fois sur chaque appareil, puis libres d'être retirés.
    c.ajoutsFaits = c.ajoutsFaits || [];
    AJOUTS.forEach((a) => {
      if (c.ajoutsFaits.includes(a.prod)) return;
      c.ajoutsFaits.push(a.prod);
      if (c.cachesProds.includes(a.prod)) return;
      if (!c.prods.includes(a.prod)) c.prods.push(a.prod);
      const e = c.ests.find((x) => x.nom === a.est);
      if (e && !e.prods.includes(a.prod) && !e.retires.includes(a.prod)) e.prods.push(a.prod);
    });
    return c;
  }
  let cfg = normaliserCfg(lire(CLE_CFG));
  let jours = lire(CLE_DATA) || {};  // { "2026-09-30": { "CHU": { "Restaurant": 64 } } }
  let file = lire(CLE_FILE) || {};   // { "date|client|produit": { date, est, prod, qty } }  (qty 0 = effacer)
  let version = 0;                   // augmente à chaque écriture : invalide les lectures du serveur en vol
  let envoiEnCours = false;
  let minuterie = null;
  let pret = false;
  let vue = [];                      // cartes affichées : [{ est, prods: [...] }]
  let renduDu = false;               // un rafraîchissement attend la fin de la saisie en cours
  let feuille = null;                // feuille plein écran ouverte
  const sauverCfg = () => { ecrire(CLE_CFG, cfg); marquer(); };

  /* ---------- Listes partagées entre les appareils ----------
     Les listes sont découpées en petits morceaux, chacun daté :
       "p"       produits (ordre) et produits supprimés ;
       "o"       ordre des clients ;
       "e:<nom>" un client : produits cochés, tarifs, ou x = 1 s'il est supprimé.
     Pour chaque morceau, la version la plus récente l'emporte. Au tout premier
     contact d'un appareil avec le serveur, rien n'est écrasé : les deux listes
     sont réunies. */
  let tampons = lire(CLE_TAMP) || {};  // { morceau: { t: date, s: contenu connu } }, _init = premier contact fait
  let partEnCours = false;
  let partMinuterie = null;
  const objet = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const textes = (l) => (Array.isArray(l) ? l.filter((x) => typeof x === "string" && x.trim()) : []);
  const unir = (a, b) => a.concat(b.filter((x) => !a.includes(x)));
  function prixPropres(src) {
    const net = {};
    if (objet(src)) Object.keys(src).sort().forEach((k) => { const v = +src[k]; if (v > 0) net[k] = Math.round(v * 100) / 100; });
    return net;
  }

  /** Les listes de cet appareil, morceau par morceau. */
  function morceaux() {
    const m = {};
    m.p = { l: cfg.prods.slice(), c: cfg.cachesProds.slice() };
    m.o = { l: cfg.ests.map((e) => e.nom) };
    cfg.ests.forEach((e) => { m["e:" + e.nom] = { x: 0, prods: e.prods.slice(), prix: prixPropres(e.prix), retires: e.retires.slice() }; });
    cfg.cachesEsts.forEach((n) => { if (!m["e:" + n]) m["e:" + n] = { x: 1 }; });
    // Un client connu qui n'existe plus ici (renommé, par exemple) est signalé comme supprimé.
    Object.keys(tampons).forEach((k) => { if (k.indexOf("e:") === 0 && !m[k]) m[k] = { x: 1 }; });
    return m;
  }

  /** Date les morceaux modifiés sur cet appareil, puis prévoit leur envoi. */
  function marquer() {
    if (!tampons._init) return; // avant le premier contact, rien n'est daté : le serveur ne doit pas être écrasé
    const m = morceaux();
    let change = false;
    Object.keys(m).forEach((k) => {
      const s = JSON.stringify(m[k]);
      if (!tampons[k] || tampons[k].s !== s) { tampons[k] = { t: Date.now(), s: s }; change = true; }
    });
    if (!change) return;
    ecrire(CLE_TAMP, tampons);
    clearTimeout(partMinuterie);
    partMinuterie = setTimeout(partager, 900);
  }

  /** Applique un morceau venu du serveur aux listes de cet appareil. */
  function appliquer(k, v) {
    if (k === "p") {
      cfg.prods = textes(v.l);
      cfg.cachesProds = textes(v.c).filter((p) => !cfg.prods.includes(p));
    } else if (k === "o") {
      const ordre = textes(v.l);
      const rang = (e) => { const i = ordre.indexOf(e.nom); return i < 0 ? 9999 : i; };
      cfg.ests = cfg.ests.map((e, i) => ({ e: e, i: i })).sort((a, b) => rang(a.e) - rang(b.e) || a.i - b.i).map((x) => x.e);
    } else if (k.indexOf("e:") === 0) {
      const nom = k.slice(2);
      if (!nom) return;
      if (v.x === 1) {
        cfg.ests = cfg.ests.filter((e) => e.nom !== nom);
        if (!cfg.cachesEsts.includes(nom)) cfg.cachesEsts.push(nom);
        return;
      }
      let e = cfg.ests.find((x) => x.nom === nom);
      if (!e) { e = { nom: nom, prods: [], prix: {}, retires: [] }; cfg.ests.push(e); }
      e.prods = textes(v.prods);
      e.prix = prixPropres(v.prix);
      e.retires = textes(v.retires);
      retirer(cfg.cachesEsts, nom);
    }
  }

  /** Premier contact : on réunit les listes du serveur et celles de l'appareil, sans rien perdre. */
  function reunir(srv) {
    const p = objet(srv.p) ? srv.p : {};
    cfg.prods = unir(cfg.prods, textes(p.l));
    cfg.cachesProds = unir(cfg.cachesProds, textes(p.c)).filter((x) => !cfg.prods.includes(x));
    Object.keys(srv).forEach((k) => {
      const v = srv[k];
      if (k.indexOf("e:") !== 0 || !objet(v) || !k.slice(2)) return;
      const nom = k.slice(2);
      let e = cfg.ests.find((x) => x.nom === nom);
      if (v.x === 1) { if (!e && !cfg.cachesEsts.includes(nom)) cfg.cachesEsts.push(nom); return; } // présent ici : il reste
      if (!e) { e = { nom: nom, prods: [], prix: {}, retires: [] }; cfg.ests.push(e); }
      e.prods = unir(e.prods, textes(v.prods));
      e.prix = Object.assign(prixPropres(e.prix), prixPropres(v.prix));
      e.retires = unir(e.retires, textes(v.retires)).filter((x) => !e.prods.includes(x));
      retirer(cfg.cachesEsts, nom);
    });
    const ordre = objet(srv.o) ? textes(srv.o.l) : [];
    if (ordre.length) appliquer("o", { l: unir(ordre, cfg.ests.map((e) => e.nom)) });
  }

  async function envoyerMorceaux(lot) {
    for (const k of Object.keys(lot)) {
      const contenu = {}, envoi = {};
      contenu[k] = lot[k];
      envoi[CLE_PART] = contenu;
      const r = await fetch(urlSync(envoi)); // un morceau par appel : l'adresse reste courte
      if (!r.ok) throw new Error("HTTP " + r.status);
    }
  }

  /** Met les listes d'accord avec le serveur. Renvoie true si les listes de cet appareil ont changé. */
  async function partager() {
    clearTimeout(partMinuterie);
    if (partEnCours || !enLigne() || typeof urlSync !== "function") return false;
    partEnCours = true;
    let change = false;
    try {
      const r = await fetch(urlSync());
      if (!r.ok) throw new Error("HTTP " + r.status);
      const tout = await r.json();
      const srv = objet(tout) && objet(tout[CLE_PART]) ? tout[CLE_PART] : {};
      const avant = JSON.stringify(cfg);
      const reglagesOuverts = !!feuille && feuille.type === "reglages"; // on ne bouscule pas une liste en cours de modification
      const dateSrv = (k) => (objet(srv[k]) && typeof srv[k].t === "number" ? srv[k].t : 0);
      if (!tampons._init) {
        reunir(srv);
        tampons = { _init: 1 };
        const m = morceaux(), t = Date.now();
        Object.keys(m).forEach((k) => { tampons[k] = { t: t, s: JSON.stringify(m[k]) }; });
      } else if (!reglagesOuverts) {
        const recus = Object.keys(srv).filter((k) => objet(srv[k]) && dateSrv(k) > ((tampons[k] || {}).t || 0));
        // Les clients d'abord, puis les produits, puis l'ordre.
        const poids = (k) => (k === "o" ? 2 : k === "p" ? 1 : 0);
        recus.sort((a, b) => poids(a) - poids(b)).forEach((k) => appliquer(k, srv[k]));
        const m = morceaux();
        recus.forEach((k) => { tampons[k] = { t: dateSrv(k), s: JSON.stringify(m[k] || { x: 1 }) }; });
        // Ce qui a bougé par ricochet (l'ordre, par exemple) est daté comme un changement d'ici.
        Object.keys(m).forEach((k) => {
          const s = JSON.stringify(m[k]);
          if (!tampons[k] || tampons[k].s !== s) tampons[k] = { t: Date.now(), s: s };
        });
      }
      change = avant !== JSON.stringify(cfg);
      if (change) ecrire(CLE_CFG, cfg);
      ecrire(CLE_TAMP, tampons);
      // Envoi de ce qui est plus récent ici que sur le serveur.
      const m = morceaux(), lot = {};
      Object.keys(m).forEach((k) => {
        const t = (tampons[k] || {}).t || 0;
        if (t > dateSrv(k)) lot[k] = Object.assign({ t: t }, m[k]);
      });
      await envoyerMorceaux(lot);
    } catch (e) {
      console.error("livraisons : listes partagées", e);
    }
    partEnCours = false;
    return change;
  }

  const dateVue = () => {
    const champ = $("l_date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(champ.value)) champ.value = iso(new Date());
    return champ.value;
  };

  const ETATS = {
    charge: "🟡 Chargement…", ok: "🟢 Synchronisé", envoi: "🟡 Envoi…",
    horsligne: "🔴 Hors ligne", erreur: "🔴 Erreur de synchro",
  };
  function majEtat(e) {
    const n = Object.keys(file).length;
    $("l_sync").textContent = ETATS[e] + (n && e !== "ok" && e !== "charge" ? " (" + n + " en attente)" : "");
  }

  /* ---------- Données ---------- */
  function poser(cible, d, est, prod, qty) {
    if (qty > 0) {
      cible[d] = cible[d] || {};
      cible[d][est] = cible[d][est] || {};
      cible[d][est][prod] = qty;
      return;
    }
    if (!cible[d] || !cible[d][est]) return;
    delete cible[d][est][prod];
    if (!Object.keys(cible[d][est]).length) delete cible[d][est];
    if (!Object.keys(cible[d]).length) delete cible[d];
  }

  /** Un nom vu dans la base rejoint les listes, sauf si l'utilisateur l'a supprimé ou décoché exprès. */
  function integrerNoms(est, prod) {
    let change = false;
    const prodCache = cfg.cachesProds.includes(prod);
    if (!prodCache && !cfg.prods.includes(prod)) { cfg.prods.push(prod); change = true; }
    if (cfg.cachesEsts.includes(est)) return change;
    let e = cfg.ests.find((x) => x.nom === est);
    if (!e) { e = { nom: est, prods: [], prix: {}, retires: [] }; cfg.ests.push(e); change = true; }
    if (!prodCache && !e.prods.includes(prod) && !e.retires.includes(prod)) { e.prods.push(prod); change = true; }
    return change;
  }

  const totalJour = (je) => Object.values(je).reduce((s, q) => s + (q > 0 ? q : 0), 0);

  /** Trie des produits : d'abord l'ordre du client, puis l'ordre général, puis l'alphabet. */
  function ordonner(noms, priorite) {
    const rang = (p) => {
      let i = priorite.indexOf(p);
      if (i >= 0) return i;
      i = cfg.prods.indexOf(p);
      return i >= 0 ? 1000 + i : 9999;
    };
    return noms.slice().sort((a, b) => rang(a) - rang(b) || a.localeCompare(b, "fr"));
  }

  /* ---------- Réseau ---------- */
  async function api(methode, requete, corps, prefer) {
    const h = { apikey: SB.cle };
    if (corps) h["Content-Type"] = "application/json";
    if (prefer) h.Prefer = prefer;
    const r = await fetch(SB.url + requete, { method: methode, headers: h, body: corps ? JSON.stringify(corps) : undefined });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
    return methode === "GET" ? r.json() : null;
  }

  /** Lit le serveur : un seul jour (d) ou tout l'historique (d = null). Renvoie false si la lecture a été jetée. */
  async function tirer(d) {
    const v0 = version;
    let lignes = [];
    if (d) {
      lignes = await api("GET", "?" + CHAMPS + "&delivery_date=eq." + d);
    } else {
      // Le serveur renvoie 1000 lignes au plus par appel : on avance page par page.
      for (let debut = 0; ; debut += 1000) {
        const page = await api("GET", "?" + CHAMPS + "&order=delivery_date.asc,establishment.asc,product.asc&limit=1000&offset=" + debut);
        lignes = lignes.concat(page);
        if (page.length < 1000) break;
      }
    }
    if (v0 !== version || envoiEnCours) return false; // une saisie est arrivée entre-temps
    const neuf = {};
    let cfgChange = false;
    lignes.forEach((l) => {
      poser(neuf, l.delivery_date, l.establishment, l.product, l.qty);
      if (integrerNoms(l.establishment, l.product)) cfgChange = true;
    });
    if (d) { if (neuf[d]) jours[d] = neuf[d]; else delete jours[d]; } else jours = neuf;
    Object.values(file).forEach((i) => poser(jours, i.date, i.est, i.prod, i.qty)); // les saisies en attente priment
    ecrire(CLE_DATA, jours);
    if (cfgChange) sauverCfg();
    return true;
  }

  /** Envoie la file d'attente. Renvoie true si tout est parti. */
  async function envoyer() {
    if (envoiEnCours) return false;
    const cles = Object.keys(file);
    if (!cles.length) return true;
    if (!enLigne()) { majEtat("horsligne"); return false; }
    envoiEnCours = true;
    majEtat("envoi");
    const lot = cles.map((k) => Object.assign({ k }, file[k]));
    try {
      const ajouts = lot.filter((i) => i.qty > 0);
      const retraits = lot.filter((i) => !(i.qty > 0));
      if (ajouts.length) {
        const maintenant = new Date().toISOString();
        await api("POST", "?on_conflict=delivery_date,establishment,product",
          ajouts.map((i) => ({ delivery_date: i.date, establishment: i.est, product: i.prod, qty: i.qty, updated_at: maintenant })),
          "resolution=merge-duplicates,return=minimal");
      }
      for (const i of retraits) {
        await api("DELETE", "?delivery_date=eq." + i.date + "&establishment=eq." + enc(i.est) + "&product=eq." + enc(i.prod), null, "return=minimal");
      }
      // On ne retire de la file que ce qui n'a pas été re-modifié pendant l'envoi.
      lot.forEach((i) => { if (file[i.k] && file[i.k].qty === i.qty) delete file[i.k]; });
      ecrire(CLE_FILE, file);
      version++;
      envoiEnCours = false;
      if (Object.keys(file).length) return envoyer();
      majEtat("ok");
      return true;
    } catch (e) {
      envoiEnCours = false;
      console.error("livraisons : envoi", e);
      majEtat(enLigne() ? "erreur" : "horsligne");
      return false;
    }
  }

  /** Attend la fin d'un envoi déjà en route, puis envoie le reste. */
  async function envoyerTout() {
    while (envoiEnCours) await new Promise((r) => setTimeout(r, 100));
    return envoyer();
  }

  /** Envoie ce qui attend puis relit le serveur (le jour affiché, ou tout si complet). */
  async function synchroniser(complet) {
    try {
      await envoyer();
      const empreinte = () => JSON.stringify(jours[dateVue()] || {}) + JSON.stringify(cfg);
      const avant = empreinte();
      const applique = await tirer(complet ? null : dateVue());
      const listes = await partager(); // clients, produits et tarifs communs à tous les appareils
      if (!Object.keys(file).length) majEtat("ok");
      if (!applique && !listes) return;
      if (avant !== empreinte()) { if (saisieEnCours()) renduDu = true; else rendreSaisie(); }
      // Feuille ouverte : on la met à jour sans déranger une saisie (recherche, réglages).
      if (feuille && feuille.type === "historique") $("l_h_liste").innerHTML = listeHistorique();
      else if (feuille && feuille.type !== "reglages") rendreFeuille();
    } catch (e) {
      console.error("livraisons : synchro", e);
      majEtat(enLigne() ? "erreur" : "horsligne");
    }
  }

  function changerQte(est, prod, qty) {
    const d = dateVue();
    const actuel = ((jours[d] || {})[est] || {})[prod] || 0;
    if (actuel === qty) return;
    poser(jours, d, est, prod, qty);
    ecrire(CLE_DATA, jours);
    file[d + "|" + est + "|" + prod] = { date: d, est: est, prod: prod, qty: qty };
    ecrire(CLE_FILE, file);
    version++;
    majEtat(enLigne() ? "envoi" : "horsligne");
    clearTimeout(minuterie);
    minuterie = setTimeout(envoyer, 700); // on attend la fin de la frappe avant d'envoyer
  }

  /* ---------- Saisie du jour ---------- */
  const saisieEnCours = () => !!document.activeElement && document.activeElement.classList.contains("l-qte");

  function rendreSaisie() {
    const d = dateVue();
    const j = jours[d] || {};
    // Jour de fermeture (mercredi, jeudi, congés) sans aucune saisie : bandeau gris à la place des cartes.
    const fermeture = Calendrier.bandeau(d, Object.keys(j).length > 0, "livraison");
    $("l_ferme").innerHTML = fermeture.html; // HTML fabriqué et échappé par calendrier.js
    $("l_ferme").hidden = !fermeture.html;
    if (fermeture.ferme) {
      vue = [];
      $("l_cartes").innerHTML = "";
      $("l_auj").classList.toggle("actif", d === iso(new Date()));
      $("l_date_txt").textContent = dateLongue(d);
      renduDu = false;
      return;
    }
    vue = cfg.ests.map((e) => {
      const je = j[e.nom] || {};
      // Un produit livré ce jour-là reste visible même s'il a été décoché depuis.
      const enPlus = Object.keys(je).filter((p) => je[p] > 0 && !e.prods.includes(p));
      return { est: e.nom, prods: e.prods.concat(enPlus) };
    });
    $("l_cartes").innerHTML = vue.length ? vue.map((c, ie) => {
      const je = j[c.est] || {};
      const lignes = c.prods.map((p, i) => {
        const q = je[p] || 0;
        return `<div class="l-ligne" data-i="${i}">
          <span class="l-nom">${esc(p)}</span>
          <div class="l-pas">
            <button type="button" data-act="moins" aria-label="Diminuer ${esc(p)}">−</button>
            <input class="l-qte${q ? " plein" : ""}" inputmode="numeric" pattern="[0-9]*" placeholder="0" value="${q || ""}" aria-label="Quantité ${esc(p)} pour ${esc(c.est)}">
            <button type="button" data-act="plus" aria-label="Augmenter ${esc(p)}">+</button>
          </div>
        </div>`;
      }).join("");
      return `<section class="l-carte" data-e="${ie}">
        <div class="l-carte-tete"><h2>${esc(c.est)}</h2><div class="l-total">Total : <b>${totalJour(je)}</b></div></div>
        ${lignes || `<p class="l-aide">Aucun produit coché pour ce client — ouvrez ⚙️ Réglages.</p>`}
      </section>`;
    }).join("") : `<div class="l-vide">Aucun client. Ouvrez ⚙️ Réglages pour en ajouter.</div>`;
    $("l_auj").classList.toggle("actif", d === iso(new Date()));
    $("l_date_txt").textContent = dateLongue(d);
    renduDu = false;
  }

  function cibleLigne(ligne) {
    const carte = ligne.closest(".l-carte");
    const c = vue[+carte.dataset.e];
    return { carte: carte, est: c.est, prod: c.prods[+ligne.dataset.i] };
  }

  function appliquerQte(ligne, q, ecrireChamp) {
    const champ = ligne.querySelector(".l-qte");
    const cible = cibleLigne(ligne);
    if (ecrireChamp) champ.value = q ? String(q) : "";
    champ.classList.toggle("plein", q > 0);
    changerQte(cible.est, cible.prod, q);
    cible.carte.querySelector(".l-total b").textContent = totalJour((jours[dateVue()] || {})[cible.est] || {});
  }

  function surClicCartes(ev) {
    const b = ev.target.closest("button[data-act]");
    if (!b) return;
    const ligne = b.closest(".l-ligne");
    const actuel = parseInt(ligne.querySelector(".l-qte").value, 10) || 0;
    appliquerQte(ligne, Math.max(0, Math.min(9999, actuel + (b.dataset.act === "plus" ? 1 : -1))), true);
  }

  function surSaisieCartes(ev) {
    const champ = ev.target;
    if (!champ.classList.contains("l-qte")) return;
    const propre = champ.value.replace(/\D/g, "").slice(0, 4);
    if (propre !== champ.value) champ.value = propre;
    appliquerQte(champ.closest(".l-ligne"), parseInt(propre, 10) || 0, false);
  }

  function changerJour(n) {
    const d = deIso(dateVue());
    d.setDate(d.getDate() + n);
    allerAu(iso(d));
  }
  function allerAu(d) {
    $("l_date").value = d;
    rendreSaisie();
    synchroniser(false);
  }

  async function enregistrer() {
    clearTimeout(minuterie);
    const ok = await envoyerTout();
    toast(ok ? "✓ Livraisons enregistrées et synchronisées"
             : "Enregistré sur cet appareil — sera envoyé au retour du réseau");
  }

  /* ---------- Documents (une description, deux sorties : écran et PDF) ---------- */
  function docBon(d) {
    const j = jours[d] || {};
    const meta = ["Bon de livraison", dateLongue(d)];
    const pages = [];
    cfg.ests.forEach((e) => {
      const je = j[e.nom];
      if (!je) return;
      const noms = ordonner(Object.keys(je).filter((p) => je[p] > 0), e.prods);
      if (!noms.length) return;
      pages.push({
        meta: meta, titre: e.nom, sous: "Livraison du " + dateCourte(d),
        table: { head: ["Produit", "Quantité"], body: noms.map((p) => [p, String(je[p])]), foot: [["Total", String(totalJour(je))]] },
        signatures: true,
      });
    });
    return { titre: "Bon du jour", fichier: "bon-livraison-" + d + ".pdf", meta: meta, pages: pages,
      vide: "Aucune livraison enregistrée pour cette journée." };
  }

  function docMois(annee, mois0, estNom) {
    const cle = annee + "-" + pad(mois0 + 1);
    const dates = Object.keys(jours).filter((d) => d.startsWith(cle + "-")).sort();
    const libelle = moisTexte(annee, mois0);
    const meta = ["Récapitulatif mensuel", libelle];
    const pied = "Édité le " + new Date().toLocaleDateString("fr-FR") + " — Merci pour votre fidélité depuis 2006.";
    const doc = { titre: "Récap " + libelle, fichier: "recap-mensuel-" + cle + (estNom ? "-" + slug(estNom) : "") + ".pdf",
      meta: meta, pages: [], vide: "Aucune livraison ce mois-ci." };

    if (estNom) {
      // --- Un client : une ligne par jour livré ---
      const e = cfg.ests.find((x) => x.nom === estNom) || { nom: estNom, prods: [], prix: {} };
      const tot = {};
      const lignes = [];
      dates.forEach((d) => {
        const je = (jours[d] || {})[estNom];
        if (!je || !totalJour(je)) return;
        Object.keys(je).forEach((p) => { if (je[p] > 0) tot[p] = (tot[p] || 0) + je[p]; });
        lignes.push({ d: d, je: je });
      });
      if (!lignes.length) return doc;
      const cols = ordonner(Object.keys(tot), e.prods);
      const grand = cols.reduce((s, p) => s + tot[p], 0);
      const foot = [["Total", ...cols.map((p) => String(tot[p])), String(grand)]];
      let encadre = null, note = null;
      if (Object.values(e.prix).some((v) => v > 0)) {
        // Calcul en centimes entiers pour éviter les erreurs d'arrondi.
        const centimes = (p) => (e.prix[p] > 0 ? Math.round(e.prix[p] * 100) : null);
        const sans = cols.filter((p) => centimes(p) === null);
        const somme = cols.reduce((s, p) => s + (centimes(p) === null ? 0 : centimes(p) * tot[p]), 0);
        foot.push(["Prix unitaire (€)", ...cols.map((p) => (centimes(p) === null ? "—" : eur(centimes(p)))), ""]);
        foot.push(["Montant TTC (€)", ...cols.map((p) => (centimes(p) === null ? "—" : eur(centimes(p) * tot[p]))), eur(somme)]);
        encadre = "TOTAL DU MOIS : " + eur(somme) + " € TTC";
        if (sans.length) note = "Prix non renseigné pour : " + sans.join(", ") + ". Ces produits ne sont pas comptés dans le total.";
      }
      doc.pages.push({
        meta: meta, titre: estNom, sous: lignes.length + (lignes.length > 1 ? " jours livrés" : " jour livré"),
        table: {
          head: ["Date", ...cols, "Total"],
          body: lignes.map((l) => [dateLigne(l.d), ...cols.map((p) => (l.je[p] > 0 ? String(l.je[p]) : "")), String(totalJour(l.je))]),
          foot: foot, largeur0: 27,
        },
        encadre: encadre, note: note, pied: pied,
      });
      return doc;
    }

    // --- Tous les clients : une ligne par client ---
    const totCol = {};
    const joursLivres = {};
    const parEst = cfg.ests.map((e) => {
      const tot = {};
      let nb = 0;
      dates.forEach((d) => {
        const je = (jours[d] || {})[e.nom];
        if (!je || !totalJour(je)) return;
        nb++;
        joursLivres[d] = true;
        Object.keys(je).forEach((p) => { if (je[p] > 0) { tot[p] = (tot[p] || 0) + je[p]; totCol[p] = (totCol[p] || 0) + je[p]; } });
      });
      return { nom: e.nom, tot: tot, nb: nb, somme: totalJour(tot) };
    }).filter((r) => r.nb > 0);
    if (!parEst.length) return doc;
    const cols = ordonner(Object.keys(totCol), []);
    const nbJours = Object.keys(joursLivres).length;
    doc.pages.push({
      meta: meta, titre: "Tous les établissements", sous: nbJours + (nbJours > 1 ? " jours de livraison" : " jour de livraison"),
      table: {
        head: ["Établissement", ...cols, "Total", "Jours"],
        body: parEst.map((r) => [r.nom, ...cols.map((p) => (r.tot[p] ? String(r.tot[p]) : "")), String(r.somme), String(r.nb)]),
        foot: [["Total", ...cols.map((p) => String(totCol[p])), String(parEst.reduce((s, r) => s + r.somme, 0)), ""]],
        largeur0: 30,
      },
      pied: pied,
    });
    return doc;
  }

  function docHtml(doc) {
    if (!doc.pages.length) return `<div class="l-vide">${esc(doc.vide)}</div>`;
    const rangee = (l, balise) => `<tr>${l.map((c) => `<${balise}>${esc(c)}</${balise}>`).join("")}</tr>`;
    return doc.pages.map((p) => `
      <div class="l-doc">
        <div class="l-doc-marque">
          <div><b>Boulangerie des Merveilles</b><small>Tende</small></div>
          <div class="l-doc-meta">${esc(p.meta[0])}<br><b>${esc(p.meta[1])}</b></div>
        </div>
        <div class="l-doc-titre"><h3>${esc(p.titre)}</h3><span>${esc(p.sous || "")}</span></div>
        <div class="l-defile"><table class="l-table${p.table.head.length <= 3 ? " l-table-2" : ""}">
          <thead>${rangee(p.table.head, "th")}</thead>
          <tbody>${p.table.body.map((l) => rangee(l, "td")).join("")}</tbody>
          <tfoot>${p.table.foot.map((l) => rangee(l, "td")).join("")}</tfoot>
        </table></div>
        ${p.encadre ? `<div class="l-encadre">${esc(p.encadre)}</div>` : ""}
        ${p.note ? `<p class="l-note">${esc(p.note)}</p>` : ""}
      </div>`).join("");
  }

  function docPdf(doc) {
    const pdf = new jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    const LARG = 210, M = 12;
    const ENCRE = [26, 15, 8], GRIS = [91, 74, 61], CREME = [250, 246, 238], VERT = [141, 182, 0], BORD = [221, 214, 200];
    const pages = doc.pages.length ? doc.pages : [{ meta: doc.meta, vide: doc.vide }];
    pages.forEach((p, n) => {
      if (n) pdf.addPage();
      // En-tête de marque
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(19); pdf.setTextColor(...ENCRE);
      pdf.text("Boulangerie des Merveilles", M, 19);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5); pdf.setTextColor(...GRIS);
      pdf.text("Tende", M, 24.5);
      pdf.text(p.meta[0], LARG - M, 19, { align: "right" });
      pdf.setFont("helvetica", "bold"); pdf.setTextColor(...ENCRE);
      pdf.text(p.meta[1], LARG - M, 24.5, { align: "right" });
      pdf.setDrawColor(...VERT); pdf.setLineWidth(0.9); pdf.line(M, 28, LARG - M, 28);
      if (p.vide) {
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(11); pdf.setTextColor(...GRIS);
        pdf.text(p.vide, M, 40);
        return;
      }
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(16); pdf.setTextColor(...ENCRE);
      pdf.text(p.titre, M, 38);
      if (p.sous) {
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5); pdf.setTextColor(138, 111, 59);
        pdf.text(p.sous, LARG - M, 38, { align: "right" });
      }
      const nc = p.table.head.length;
      const deuxColonnes = nc <= 3;
      const colonnes = {};
      if (p.table.largeur0) colonnes[0] = { cellWidth: p.table.largeur0 };
      if (deuxColonnes) colonnes[nc - 1] = { cellWidth: 36 };
      pdf.autoTable({
        startY: 42, margin: { left: M, right: M, bottom: 16 },
        head: [p.table.head], body: p.table.body, foot: p.table.foot,
        theme: "grid", showFoot: "lastPage",
        styles: { font: "helvetica", fontSize: deuxColonnes ? 11 : nc <= 8 ? 9 : nc <= 12 ? 8 : 7,
          cellPadding: deuxColonnes ? 2.2 : 1.4, halign: "center", valign: "middle",
          textColor: ENCRE, lineColor: BORD, lineWidth: 0.2, overflow: "linebreak" },
        headStyles: { fillColor: CREME, textColor: ENCRE, fontStyle: "bold" },
        footStyles: { fillColor: CREME, textColor: ENCRE, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [247, 247, 245] },
        columnStyles: colonnes,
        didParseCell: (c) => {
          if (c.column.index === 0) c.cell.styles.halign = "left";
          else if (deuxColonnes && c.column.index === nc - 1) c.cell.styles.halign = "right";
        },
      });
      let y = pdf.lastAutoTable.finalY + 8;
      const place = (h) => { if (y + h > 285) { pdf.addPage(); y = 20; } };
      if (p.encadre) {
        place(16);
        pdf.setDrawColor(...VERT); pdf.setLineWidth(0.7); pdf.setFillColor(...CREME);
        pdf.roundedRect(M, y, LARG - 2 * M, 13, 1.5, 1.5, "FD");
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(13.5); pdf.setTextColor(...ENCRE);
        pdf.text(p.encadre, LARG / 2, y + 8.4, { align: "center" });
        y += 19;
      }
      if (p.note) {
        place(10);
        pdf.setFont("helvetica", "italic"); pdf.setFontSize(8.5); pdf.setTextColor(...GRIS);
        const texte = pdf.splitTextToSize(p.note, LARG - 2 * M);
        pdf.text(texte, M, y);
        y += texte.length * 4 + 4;
      }
      if (p.signatures) {
        place(28);
        y += 16;
        const moitie = (LARG - 2 * M - 10) / 2;
        pdf.setDrawColor(...ENCRE); pdf.setLineWidth(0.3);
        pdf.line(M, y, M + moitie, y);
        pdf.line(M + moitie + 10, y, LARG - M, y);
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5); pdf.setTextColor(...ENCRE);
        pdf.text("Livré par :", M, y + 5);
        pdf.text("Reçu par :", M + moitie + 10, y + 5);
        y += 12;
      }
      if (p.pied) {
        place(10);
        pdf.setDrawColor(...BORD); pdf.setLineWidth(0.2); pdf.line(M, y, LARG - M, y);
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5); pdf.setTextColor(...GRIS);
        pdf.text(p.pied, LARG / 2, y + 5, { align: "center" });
      }
    });
    return pdf;
  }

  /* ---------- Feuilles plein écran ---------- */
  function ouvrir(f) {
    feuille = f;
    $("l_feuille").hidden = false;
    document.body.style.overflow = "hidden";
    rendreFeuille(true);
  }
  function fermer() {
    feuille = null;
    $("l_feuille").hidden = true;
    document.body.style.overflow = "";
    rendreSaisie();
  }
  function retour() {
    if (feuille && feuille.retour) { feuille = feuille.retour; rendreFeuille(true); } else fermer();
  }

  const boutonsDoc = (doc) => {
    const off = doc.pages.length ? "" : " disabled";
    return `<button class="l-btn" data-act="pdf"${off}>⬇︎ PDF</button>
            <button class="l-btn l-btn-2" data-act="imprimer"${off}>🖨 Imprimer</button>`;
  };

  function rendreFeuille(haut) {
    if (!feuille) return;
    const corps = $("l_f_corps");
    const defilement = haut ? 0 : corps.scrollTop;
    let contenu;
    if (feuille.type === "bon") contenu = feuilleBon();
    else if (feuille.type === "recap") contenu = feuilleRecap();
    else if (feuille.type === "historique") contenu = feuilleHistorique();
    else contenu = feuilleReglages();
    $("l_f_titre").textContent = contenu.titre;
    $("l_f_retour").textContent = feuille.retour ? "‹" : "✕";
    $("l_f_retour").setAttribute("aria-label", feuille.retour ? "Retour" : "Fermer");
    corps.innerHTML = contenu.corps;
    $("l_f_pied").innerHTML = contenu.pied || "";
    corps.scrollTop = defilement;
  }

  function feuilleBon() {
    feuille.doc = docBon(dateVue());
    return { titre: "Bon du jour", corps: docHtml(feuille.doc), pied: boutonsDoc(feuille.doc) };
  }

  const optionsEst = (choisi) => `<option value="">Tous les établissements</option>` +
    cfg.ests.map((e, i) => `<option value="${i}"${e.nom === choisi ? " selected" : ""}>${esc(e.nom)}</option>`).join("");

  function feuilleRecap() {
    feuille.doc = docMois(feuille.annee, feuille.mois, feuille.est || null);
    return {
      titre: "Récap du mois",
      corps: `<div class="l-mois-nav">
          <button data-act="moisPrec" aria-label="Mois précédent">‹</button>
          <div class="l-mois-nom">${esc(moisTexte(feuille.annee, feuille.mois))}</div>
          <button data-act="moisSuiv" aria-label="Mois suivant">›</button>
        </div>
        <select class="l-select" id="l_r_est" aria-label="Établissement">${optionsEst(feuille.est)}</select>
        ${docHtml(feuille.doc)}`,
      pied: boutonsDoc(feuille.doc),
    };
  }

  function moisDisponibles(est) {
    const noms = est ? [est] : cfg.ests.map((e) => e.nom);
    const m = {};
    Object.keys(jours).forEach((d) => {
      const t = noms.reduce((s, n) => s + totalJour(jours[d][n] || {}), 0);
      if (!t) return;
      const k = d.slice(0, 7);
      m[k] = m[k] || { cle: k, total: 0, nb: 0 };
      m[k].total += t;
      m[k].nb++;
    });
    return Object.values(m).sort((a, b) => (a.cle < b.cle ? 1 : -1));
  }

  function listeHistorique() {
    const q = (feuille.q || "").trim().toLowerCase();
    const liste = moisDisponibles(feuille.est).map((m) => {
      const parts = m.cle.split("-").map(Number);
      return Object.assign({ texte: moisTexte(parts[0], parts[1] - 1) }, m);
    }).filter((m) => !q || m.cle.includes(q) || m.texte.toLowerCase().includes(q));
    if (!liste.length) return `<div class="l-vide">Aucune livraison trouvée pour ${esc(feuille.est || "tous les établissements")}.</div>`;
    return liste.map((m) => `<button class="l-mois-item" data-act="ouvrirMois" data-cle="${esc(m.cle)}">
        <span><b>${esc(m.texte)}</b><small>${m.nb} jour${m.nb > 1 ? "s" : ""} livré${m.nb > 1 ? "s" : ""}</small></span>
        <span class="l-pastille">${m.total}</span>
      </button>`).join("");
  }

  function feuilleHistorique() {
    return {
      titre: "Historique",
      corps: `<select class="l-select" id="l_h_est" aria-label="Établissement">${optionsEst(feuille.est)}</select>
        <input class="l-champ" id="l_h_q" placeholder="Rechercher un mois (ex. septembre)" value="${esc(feuille.q || "")}">
        <div id="l_h_liste">${listeHistorique()}</div>`,
    };
  }

  function feuilleReglages() {
    const ed = feuille.edition;
    const tete = (type, nom, boutons) => (ed && ed.type === type && ed.nom === nom)
      ? `<input class="l-champ" id="l_edit" value="${esc(nom)}" aria-label="Nouveau nom">
         <button class="l-mini" data-act="validerNom" aria-label="Valider">✓</button>
         <button class="l-mini" data-act="annulerNom" aria-label="Annuler">✕</button>`
      : boutons;
    const onglets = `<button type="button" class="l-btn l-btn-2 l-large" data-cal="gestion">📅 Fermetures et congés</button>
      <div class="l-onglets">
        <button data-act="onglet" data-onglet="ests" class="${feuille.onglet === "ests" ? "actif" : ""}">Clients</button>
        <button data-act="onglet" data-onglet="prods" class="${feuille.onglet === "prods" ? "actif" : ""}">Produits</button>
      </div>`;
    if (feuille.onglet === "prods") {
      return {
        titre: "Réglages",
        corps: onglets + `<div class="l-ajout">
            <input class="l-champ" id="l_new_prod" placeholder="Nom du produit">
            <button class="l-btn" data-act="ajouterProd">Ajouter</button>
          </div>` + cfg.prods.map((p, i) => `<div class="l-item" data-p="${i}">${tete("prod", p, `
            <span>${esc(p)}</span>
            <button class="l-mini" data-act="renommer" aria-label="Renommer ${esc(p)}">✎</button>
            <button class="l-mini danger" data-act="supprimer" aria-label="Supprimer ${esc(p)}">🗑</button>`)}</div>`).join(""),
      };
    }
    return {
      titre: "Réglages",
      corps: onglets + `<div class="l-ajout">
          <input class="l-champ" id="l_new_est" placeholder="Nom du client">
          <button class="l-btn" data-act="ajouterEst">Ajouter</button>
        </div>` + cfg.ests.map((e, i) => `<div class="l-bloc" data-e="${i}">
          <div class="l-bloc-tete">${tete("est", e.nom, `
            <b>${esc(e.nom)}</b>
            <button class="l-mini" data-act="monter" aria-label="Monter ${esc(e.nom)}">↑</button>
            <button class="l-mini" data-act="descendre" aria-label="Descendre ${esc(e.nom)}">↓</button>
            <button class="l-mini" data-act="renommer" aria-label="Renommer ${esc(e.nom)}">✎</button>
            <button class="l-mini danger" data-act="supprimer" aria-label="Supprimer ${esc(e.nom)}">🗑</button>`)}
          </div>
          <div class="l-petit-titre">Produits livrés</div>
          <div class="l-coches">${cfg.prods.map((p, ip) => `<label>
            <input type="checkbox" data-coche="${ip}"${e.prods.includes(p) ? " checked" : ""}> ${esc(p)}</label>`).join("")}</div>
          <details data-details="${i}"${feuille.ouverts.includes(e.nom) ? " open" : ""}>
            <summary>Tarifs € TTC (facultatif)</summary>
            <div class="l-tarifs">${e.prods.map((p) => `<label><span>${esc(p)}</span>
              <input type="text" inputmode="decimal" placeholder="—" data-prix="${cfg.prods.indexOf(p)}" value="${e.prix[p] > 0 ? prixTexte(e.prix[p]) : ""}" aria-label="Prix ${esc(p)}"> €</label>`).join("")
              || `<p class="l-aide">Cochez d'abord les produits livrés à ce client.</p>`}</div>
            <p class="l-aide">Dès qu'un tarif est renseigné, le récap mensuel de ce client affiche son total en euros.</p>
          </details>
        </div>`).join(""),
    };
  }

  /* ---------- Confirmation ---------- */
  function demander(message, libelle, danger) {
    return new Promise((resoudre) => {
      $("l_conf_msg").textContent = message;
      const oui = $("l_conf_oui"), non = $("l_conf_non");
      oui.textContent = libelle;
      oui.classList.toggle("danger", !!danger);
      $("l_conf").hidden = false;
      const finir = (reponse) => { $("l_conf").hidden = true; oui.onclick = non.onclick = null; resoudre(reponse); };
      oui.onclick = () => finir(true);
      non.onclick = () => finir(false);
    });
  }

  /* ---------- Réglages : actions ---------- */
  const retirer = (liste, valeur) => { const i = liste.indexOf(valeur); if (i >= 0) liste.splice(i, 1); };

  function ajouterEst() {
    const nom = $("l_new_est").value.trim();
    if (!nom) return;
    if (cfg.ests.some((e) => e.nom === nom)) { toast("Ce client existe déjà"); return; }
    cfg.ests.push({ nom: nom, prods: [], prix: {}, retires: [] });
    retirer(cfg.cachesEsts, nom);
    sauverCfg();
    rendreFeuille();
    $("l_f_corps").scrollTop = $("l_f_corps").scrollHeight;
    toast("Client ajouté — cochez ses produits");
  }

  function ajouterProd() {
    const nom = $("l_new_prod").value.trim();
    if (!nom) return;
    if (cfg.prods.includes(nom)) { toast("Ce produit existe déjà"); return; }
    cfg.prods.push(nom);
    retirer(cfg.cachesProds, nom);
    sauverCfg();
    rendreFeuille();
    $("l_f_corps").scrollTop = $("l_f_corps").scrollHeight;
    toast("Produit ajouté — cochez-le chez les clients concernés");
  }

  /** Renomme partout : dans la base (toutes les livraisons suivent) puis sur cet appareil. */
  async function renommer(type, ancien, nouveau) {
    nouveau = nouveau.trim();
    if (!nouveau || nouveau === ancien) return true;
    const pris = type === "est" ? cfg.ests.some((e) => e.nom === nouveau) : cfg.prods.includes(nouveau);
    if (pris) { toast("Ce nom existe déjà"); return false; }
    if (!enLigne()) { toast("Il faut une connexion internet pour renommer"); return false; }
    const ok = await demander("Renommer « " + ancien + " » en « " + nouveau + " » ? Les livraisons déjà enregistrées suivront le nouveau nom.", "Renommer");
    if (!ok) return false;
    clearTimeout(minuterie);
    if (!(await envoyerTout())) { toast("Synchronisation impossible — réessayez dans un instant"); return false; }
    const colonne = type === "est" ? "establishment" : "product";
    try {
      const corps = { updated_at: new Date().toISOString() };
      corps[colonne] = nouveau;
      await api("PATCH", "?" + colonne + "=eq." + enc(ancien), corps, "return=minimal");
    } catch (e) {
      console.error("livraisons : renommage", e);
      toast("Renommage impossible : ce nom est peut-être déjà utilisé dans des livraisons");
      return false;
    }
    const remplacer = (liste) => liste.map((x) => (x === ancien ? nouveau : x));
    const deplacer = (objet) => { if (ancien in objet) { objet[nouveau] = objet[ancien]; delete objet[ancien]; } };
    if (type === "est") {
      cfg.ests.find((e) => e.nom === ancien).nom = nouveau;
      retirer(cfg.cachesEsts, nouveau);
      Object.values(jours).forEach(deplacer);
      feuille.ouverts = remplacer(feuille.ouverts);
    } else {
      cfg.prods = remplacer(cfg.prods);
      retirer(cfg.cachesProds, nouveau);
      cfg.ests.forEach((e) => { e.prods = remplacer(e.prods); e.retires = remplacer(e.retires); deplacer(e.prix); });
      Object.values(jours).forEach((j) => Object.values(j).forEach(deplacer));
    }
    version++;
    sauverCfg();
    ecrire(CLE_DATA, jours);
    toast("✓ Renommé");
    return true;
  }

  async function supprimer(type, nom) {
    const message = type === "est"
      ? "Supprimer le client « " + nom + " » sur tous les appareils ? Ses livraisons restent enregistrées et reviennent si vous le recréez avec le même nom."
      : "Supprimer le produit « " + nom + " » sur tous les appareils ? Il sera retiré de tous les clients ; les livraisons déjà enregistrées sont conservées.";
    if (!(await demander(message, "Supprimer", true))) return;
    if (type === "est") {
      cfg.ests = cfg.ests.filter((e) => e.nom !== nom);
      if (!cfg.cachesEsts.includes(nom)) cfg.cachesEsts.push(nom);
    } else {
      cfg.prods = cfg.prods.filter((p) => p !== nom);
      cfg.ests.forEach((e) => { retirer(e.prods, nom); delete e.prix[nom]; });
      if (!cfg.cachesProds.includes(nom)) cfg.cachesProds.push(nom);
    }
    sauverCfg();
    rendreFeuille();
  }

  /* ---------- Feuilles : événements ---------- */
  function decalerMois(n) {
    const d = new Date(feuille.annee, feuille.mois + n, 1);
    feuille.annee = d.getFullYear();
    feuille.mois = d.getMonth();
    rendreFeuille(true);
  }

  async function surClicFeuille(ev) {
    const b = ev.target.closest("[data-act]");
    if (!b || !feuille) return;
    const bloc = b.closest("[data-e]"), item = b.closest("[data-p]");
    const typeCible = bloc ? "est" : "prod";
    const nomCible = bloc ? cfg.ests[+bloc.dataset.e].nom : item ? cfg.prods[+item.dataset.p] : null;
    switch (b.dataset.act) {
      case "pdf":
        docPdf(feuille.doc).save(feuille.doc.fichier);
        toast("PDF téléchargé : " + feuille.doc.fichier);
        break;
      case "imprimer": {
        const pdf = docPdf(feuille.doc);
        try { pdf.autoPrint(); if (!window.open(pdf.output("bloburl"), "_blank")) throw new Error("fenêtre bloquée"); }
        catch (e) { pdf.save(feuille.doc.fichier); toast("Impression directe impossible ici — PDF téléchargé à la place"); }
        break;
      }
      case "moisPrec": decalerMois(-1); break;
      case "moisSuiv": decalerMois(1); break;
      case "ouvrirMois": {
        const parts = b.dataset.cle.split("-").map(Number);
        ouvrir({ type: "recap", annee: parts[0], mois: parts[1] - 1, est: feuille.est, retour: feuille });
        break;
      }
      case "onglet": feuille.onglet = b.dataset.onglet; feuille.edition = null; rendreFeuille(true); break;
      case "ajouterEst": ajouterEst(); break;
      case "ajouterProd": ajouterProd(); break;
      case "monter":
      case "descendre": {
        const i = +bloc.dataset.e, k = i + (b.dataset.act === "monter" ? -1 : 1);
        if (k < 0 || k >= cfg.ests.length) break;
        const t = cfg.ests[i]; cfg.ests[i] = cfg.ests[k]; cfg.ests[k] = t;
        sauverCfg();
        rendreFeuille();
        break;
      }
      case "renommer":
        feuille.edition = { type: typeCible, nom: nomCible };
        rendreFeuille();
        $("l_edit").focus();
        $("l_edit").select();
        break;
      case "annulerNom": feuille.edition = null; rendreFeuille(); break;
      case "validerNom":
        if (await renommer(feuille.edition.type, feuille.edition.nom, $("l_edit").value)) { feuille.edition = null; rendreFeuille(); }
        break;
      case "supprimer": await supprimer(typeCible, nomCible); break;
    }
  }

  function surChangementFeuille(ev) {
    const c = ev.target;
    if (!feuille) return;
    if (c.id === "l_r_est" || c.id === "l_h_est") {
      feuille.est = c.value === "" ? null : cfg.ests[+c.value].nom;
      rendreFeuille();
      return;
    }
    const bloc = c.closest("[data-e]");
    if (!bloc) return;
    const e = cfg.ests[+bloc.dataset.e];
    if (c.dataset.coche !== undefined) {
      const p = cfg.prods[+c.dataset.coche];
      if (c.checked) { if (!e.prods.includes(p)) e.prods.push(p); retirer(e.retires, p); }
      else { retirer(e.prods, p); if (!e.retires.includes(p)) e.retires.push(p); }
      sauverCfg();
      rendreFeuille();
    } else if (c.dataset.prix !== undefined) {
      const p = cfg.prods[+c.dataset.prix];
      // Champ texte (et non « nombre ») : accepte la virgule comme le point, quelle que soit la langue du téléphone.
      const v = parseFloat(String(c.value).replace(",", ".").replace(/[^0-9.]/g, ""));
      if (v > 0) { e.prix[p] = Math.round(v * 100) / 100; c.value = prixTexte(e.prix[p]); }
      else { delete e.prix[p]; c.value = ""; }
      sauverCfg();
    }
  }

  function surSaisieFeuille(ev) {
    if (feuille && ev.target.id === "l_h_q") { feuille.q = ev.target.value; $("l_h_liste").innerHTML = listeHistorique(); }
  }

  function surToucheFeuille(ev) {
    if (ev.key !== "Enter" || !feuille) return;
    const id = ev.target.id;
    if (id === "l_new_est") ajouterEst();
    else if (id === "l_new_prod") ajouterProd();
    else if (id === "l_edit") $("l_f_corps").querySelector('[data-act="validerNom"]').click();
  }

  // L'événement « toggle » des <details> ne remonte pas : on l'écoute en phase de capture.
  function surBasculeDetails(ev) {
    const d = ev.target;
    if (!feuille || feuille.type !== "reglages" || d.dataset.details === undefined) return;
    const nom = cfg.ests[+d.dataset.details].nom;
    retirer(feuille.ouverts, nom);
    if (d.open) feuille.ouverts.push(nom);
  }

  /* ---------- Démarrage ---------- */
  function demarrer() {
    $("l_date").value = iso(new Date());
    $("l_date").addEventListener("change", () => allerAu(dateVue()));
    $("l_prec").addEventListener("click", () => changerJour(-1));
    $("l_suiv").addEventListener("click", () => changerJour(1));
    $("l_auj").addEventListener("click", () => allerAu(iso(new Date())));

    const cartes = $("l_cartes");
    cartes.addEventListener("click", surClicCartes);
    cartes.addEventListener("input", surSaisieCartes);
    cartes.addEventListener("focusin", (ev) => { if (ev.target.classList.contains("l-qte")) ev.target.select(); });
    cartes.addEventListener("focusout", () => setTimeout(() => { if (renduDu && !saisieEnCours()) rendreSaisie(); }, 150));

    $("l_outils").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-act]");
      if (!b) return;
      const d = deIso(dateVue());
      if (b.dataset.act === "historique") ouvrir({ type: "historique", est: null, q: "" });
      else if (b.dataset.act === "recap") ouvrir({ type: "recap", annee: d.getFullYear(), mois: d.getMonth(), est: null });
      else ouvrir({ type: "reglages", onglet: "ests", edition: null, ouverts: [] });
      if (b.dataset.act !== "reglages") synchroniser(true); // l'historique a besoin de toutes les livraisons
    });
    $("l_bon").addEventListener("click", () => ouvrir({ type: "bon" }));
    $("l_enregistrer").addEventListener("click", enregistrer);

    const f = $("l_feuille");
    $("l_f_retour").addEventListener("click", retour);
    f.addEventListener("click", surClicFeuille);
    f.addEventListener("change", surChangementFeuille);
    f.addEventListener("input", surSaisieFeuille);
    f.addEventListener("keydown", surToucheFeuille);
    f.addEventListener("toggle", surBasculeDetails, true);

    Calendrier.surChangement(rendreSaisie); // fermetures et congés modifiés : on réaffiche le jour
    rendreSaisie();
    majEtat(enLigne() ? "charge" : "horsligne");
    synchroniser(true);
    setInterval(() => { if (actif() && !document.hidden && !feuille) synchroniser(false); }, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && actif()) synchroniser(false); });
    window.addEventListener("online", () => synchroniser(false));
    window.addEventListener("offline", () => majEtat("horsligne"));
  }

  /** Appelé chaque fois que l'onglet Livraisons devient visible. */
  function afficher() {
    if (!pret) { pret = true; demarrer(); } else synchroniser(false);
  }

  return { afficher: afficher };
})();
