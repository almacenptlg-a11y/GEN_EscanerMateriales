/**
 * @fileoverview GenFiler Scanner Station - Application Core
 * @author Senior Full-Stack Engineer
 */

const GAS_API_URL =
  "https://script.google.com/macros/s/AKfycbxLBQ40gDuBCPCVl1Jr1woBlqf2aLjm79imBLkREIyCfTAlkt1h6R7ACadIpZBiq6Tv/exec";
const BASE_IMAGE_URL =
  "https://www.appsheet.com/template/gettablefileurl?appName=4a927982-17f8-4eac-92c2-f2d644cf7d51&tableName=MATERIALES&fileName=";

class BarcodeEngine {
  static validate(code) {
    const str = String(code || "").trim();
    if (!str) return { valid: false, tag: "Sin Código Lector" };
    if (!/^\d+$/.test(str))
      return { valid: false, tag: "Inválido (Alfanumérico)" };
    if (str.length !== 13 && str.length !== 12 && str.length !== 8)
      return { valid: false, tag: `Long. Anómala (${str.length})` };

    const padded = str.length === 12 ? "0" + str : str;
    const digits = padded.split("").map(Number);
    const checksum = digits.pop();
    let sum = 0;

    if (padded.length === 13)
      digits.forEach((d, i) => (sum += d * (i % 2 === 0 ? 1 : 3)));
    else if (padded.length === 8)
      digits.forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)));

    const expected = (10 - (sum % 10)) % 10;
    return expected === checksum
      ? { valid: true, tag: "GS1 Correcto" }
      : { valid: false, tag: `Error CheckDigit (Esp: ${expected})` };
  }
}

class ScannerStation {
  constructor() {
    this.hashData = new Map();
    this.rawDataset = [];
    this.duplicates = [];
    this.gs1Errors = [];
    this.currentUser = null;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = AudioContext ? new AudioContext() : null;

    this.html5QrCode = null;
    this.isCameraActive = false;
    this.activeCollisionFilter = "ALL";

    // Modificamos el ciclo de vida: NO arrancamos init() inmediatamente.
    // Primero, pedimos la autenticación al Padre a través del puente.
    this.checkAuth();
  }

// ==========================================
  // GESTIÓN DE SESIÓN (MICRO-FRONTEND BRIDGE)
  // ==========================================
  checkAuth() {
    window.addEventListener('message', (event) => {
      const { type, user, theme } = event.data || {};
      
      if (type === 'THEME_UPDATE') {
        document.documentElement.classList.toggle('dark', theme === 'dark');
      }

      if (type === 'SESSION_SYNC' && user) {
        console.log("HUB Materiales: Sesión recibida del HUB Padre.");
        document.documentElement.classList.toggle('dark', theme === 'dark');
        
        this.currentUser = user;
        sessionStorage.setItem('moduloUser', JSON.stringify(user));
        
        const avatarEl = document.getElementById("user-avatar");
        const nameEl = document.getElementById("user-name");
        const roleEl = document.getElementById("user-role");

        if (avatarEl && nameEl && this.currentUser.nombre) {
          const nameParts = this.currentUser.nombre.split(" ");
          const init1 = nameParts[0].charAt(0).toUpperCase();
          const init2 = nameParts.length > 1 ? nameParts[1].charAt(0).toUpperCase() : "";
          
          avatarEl.innerText = `${init1}${init2}`;
          nameEl.innerText = nameParts[0];
          roleEl.innerText = this.currentUser.rol || "Operador";
          
          const badge = document.getElementById("user-profile-badge");
          if (badge) {
            badge.classList.remove("hidden");
            badge.classList.add("flex");
          }
        }

        // ==========================================
        // ARRANQUE SEGURO: Inicia la UI solo una vez
        // ==========================================
        this.bootSystem();
      }
    });

    const savedUser = sessionStorage.getItem('moduloUser');
    if (savedUser) {
      console.log("HUB Materiales: Sesión recuperada desde caché local.");
      this.currentUser = JSON.parse(savedUser);
    }

    if (window !== window.top) {
      window.parent.postMessage({ type: 'MODULO_LISTO' }, '*');
      setTimeout(() => {
        if (!this.currentUser) {
          console.error("HUB Materiales: El HUB Central no autorizó la sesión.");
          this.showAccessDenied("El servidor principal no emitió autorización de sesión.");
        }
      }, 4000);
    } else {
      const sessionRaw = localStorage.getItem('genapps_session');
      if (sessionRaw) {
        this.currentUser = typeof sessionRaw === 'string' ? JSON.parse(sessionRaw) : sessionRaw;
        this.bootSystem();
      } else {
        this.showAccessDenied("Debes iniciar sesión en el entorno padre.");
      }
    }
  }

  // ==========================================
  // BOOTLOADER: Construye la Interfaz antes de llamar a BD
  // ==========================================
  bootSystem() {
    if (this.isBooted) return; // Previene fugas de memoria si se ejecuta doble
    
    this.setupThemeToggle();
    this.setupUI();
    this.setupCamera();
    this.setupTabs();
    this.setupImageModal();
    this.setupEditForm();
    
    this.isBooted = true;
    
    // Una vez conectada toda la UI, hacemos la llamada a la base de datos
    this.init();
  }

  showAccessDenied(reason = "") {
    document.body.innerHTML = `
      <div class="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6 text-center transition-colors">
        <div class="bg-white dark:bg-slate-900 p-8 rounded-[2rem] shadow-xl border border-slate-200 dark:border-slate-800 max-w-sm w-full">
          <div class="w-20 h-20 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
          </div>
          <h1 class="text-2xl font-black text-slate-900 dark:text-white tracking-widest uppercase mb-2">Acceso Restringido</h1>
          <p class="text-sm font-medium text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">Debes iniciar sesión desde el HUB Central para acceder a la Estación de Materiales.</p>
          <p class="text-xs text-rose-500">${reason}</p>
        </div>
      </div>
    `;
  }

  setupThemeToggle() {
    const btnTheme = document.getElementById("btn-theme-toggle");
    if (!btnTheme) return;

    btnTheme.addEventListener("click", () => {
      btnTheme.classList.add("scale-90");
      setTimeout(() => btnTheme.classList.remove("scale-90"), 200);

      const html = document.documentElement;
      let newTheme = 'light';

      if (html.classList.contains("dark")) {
        html.classList.remove("dark");
        localStorage.setItem("genapps_theme", "light");
      } else {
        html.classList.add("dark");
        localStorage.setItem("genapps_theme", "dark");
        newTheme = 'dark';
      }

      if (window !== window.top) {
        window.parent.postMessage({ action: 'TOGGLE_THEME', theme: newTheme }, '*');
      }
    });
  }

 // ==========================================
  // CONEXIÓN A BASE DE DATOS (Solo Datos, sin UI)
  // ==========================================
  async init(forceRefresh = false) {
    try {
      const status = document.getElementById("system-status");
      const btnRefreshDesktop = document.getElementById("btn-refresh-db");
      const btnRefreshMobile = document.getElementById("btn-refresh-db-nav");

      const allRefreshBtns = [btnRefreshDesktop, btnRefreshMobile].filter(Boolean);

      if (status) {
        status.className =
          "px-4 py-2 rounded-full bg-amber-100 dark:bg-amber-900/30 text-xs font-bold text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700/50 skeleton transition-colors";
        status.innerText = forceRefresh
          ? "Forzando Sincronización..."
          : "Conectando a DB...";
      }

      // ==========================================
      // ANIMACIÓN FLUIDA: Quitamos el freno de CSS y ponemos el motor de giro
      // ==========================================
      allRefreshBtns.forEach((btn) => {
        const icon = btn.querySelector("svg");
        if (icon) {
          // 1. Quitamos las transiciones de hover que interfieren
          icon.classList.remove("transition-transform", "duration-500", "transform", "group-hover:rotate-[360deg]");
          // 2. Encendemos el giro infinito nativo de Tailwind
          icon.classList.add("animate-spin");
        }
      });

      const url = forceRefresh ? `${GAS_API_URL}?refresh=true` : GAS_API_URL;
      const response = await fetch(url);

      if (!response.ok)
        throw new Error(`Error de red: ${response.status} ${response.statusText}`);

      const data = await response.json();
      if (data.status === "error")
        throw new Error(data.message || "Error devuelto por el servidor.");

      this.hashData.clear();
      this.duplicates = [];
      this.gs1Errors = [];
      this.rawDataset = Array.isArray(data.data) ? data.data : [];

      this.buildDataGraph(this.rawDataset);
      this.populateAuditTab();

      // ==========================================
      // FIN ANIMACIÓN: Apagamos el giro y devolvemos las clases de hover
      // ==========================================
      allRefreshBtns.forEach((btn) => {
        const icon = btn.querySelector("svg");
        if (icon) {
          icon.classList.remove("animate-spin");
          icon.classList.add("transition-transform", "duration-500", "transform", "group-hover:rotate-[360deg]");
        }
      });
      
    } catch (err) {
      this.showSystemError(err);
      
      const btnRefreshDesktop = document.getElementById("btn-refresh-db");
      const btnRefreshMobile = document.getElementById("btn-refresh-db-nav");
      
      // Detenemos la animación también si ocurre un error
      [btnRefreshDesktop, btnRefreshMobile].filter(Boolean).forEach((btn) => {
        const icon = btn.querySelector("svg");
        if (icon) {
          icon.classList.remove("animate-spin");
          icon.classList.add("transition-transform", "duration-500", "transform", "group-hover:rotate-[360deg]");
        }
      });
    }
  }   
  buildDataGraph(dataset) {
    if (!dataset || !Array.isArray(dataset)) return;

    dataset.forEach((item) => {
      const codes = [
        { type: "ID_PRDC", val: String(item.id || "").trim() },
        { type: "SKU", val: String(item.sku || "").trim() },
        { type: "ALU", val: String(item.alu || "").trim() },
        { type: "BARCODE", val: String(item.barcode || "").trim() }
      ].filter((c) => {
        const v = c.val.toUpperCase();
        return (
          v.length > 0 &&
          v !== "-" &&
          v !== "0" &&
          v !== "N/A" &&
          v !== "NA" &&
          v !== "NULL"
        );
      });

      item.validation = BarcodeEngine.validate(item.barcode);
      if (!item.validation.valid && item.barcode) {
        const b = String(item.barcode).trim().toUpperCase();
        if (b.length > 0 && b !== "-" && b !== "0" && b !== "N/A") {
          this.gs1Errors.push(item);
        }
      }

      codes.forEach((codeObj) => {
        if (this.hashData.has(codeObj.val)) {
          const existingItem = this.hashData.get(codeObj.val);
          if (existingItem.id !== item.id) {
            this.duplicates.push({
              type: codeObj.type,
              key: codeObj.val,
              item1: existingItem,
              item2: item
            });
          }
        } else {
          this.hashData.set(codeObj.val, item);
        }
      });
    });

    const status = document.getElementById("system-status");
    if (status) {
      status.className =
        "px-6 py-2 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/40 text-xs font-black tracking-widest uppercase drop-shadow-sm dark:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-colors";
      status.innerText = `En Línea: ${dataset.length} Items`;
    }
  }

  // ==========================================
  // NAVEGACIÓN Y TABS
  // ==========================================
  setupTabs() {
    const tabScanner = document.getElementById("tab-scanner");
    const tabAudit = document.getElementById("tab-audit");

    const btnScanHeader = document.getElementById("tab-btn-scanner");
    const btnAuditHeader = document.getElementById("tab-btn-audit");
    const btnScanMobile = document.getElementById("nav-btn-scanner");
    const btnAuditMobile = document.getElementById("nav-btn-audit");
    const btnScanDesktop = document.getElementById("desktop-nav-btn-scanner");
    const btnAuditDesktop = document.getElementById("desktop-nav-btn-audit");

    const totalAlerts = this.duplicates.length + this.gs1Errors.length;
    if (totalAlerts > 0) {
      document.querySelectorAll("#badge-audit").forEach((badge) => {
        badge.innerText = totalAlerts > 99 ? "+99" : totalAlerts;
        badge.classList.remove("hidden");
      });
    }

    const switchToScanner = () => {
      if (tabScanner) {
        tabScanner.classList.remove("hidden");
        tabScanner.classList.add("flex");
      }
      if (tabAudit) {
        tabAudit.classList.add("hidden");
        tabAudit.classList.remove("flex");
      }

      if (btnScanHeader)
        btnScanHeader.className =
          "px-6 py-2 rounded-lg text-sm font-bold bg-emerald-500 text-white dark:bg-emerald-500/20 dark:text-emerald-400 transition-all shadow-md dark:shadow-none";
      if (btnAuditHeader)
        btnAuditHeader.className =
          "px-6 py-2 rounded-lg text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all relative";

      if (btnScanMobile) {
        btnScanMobile.classList.add(
          "text-blue-600",
          "dark:text-blue-500",
          "nav-active"
        );
        btnScanMobile.classList.remove(
          "text-slate-400",
          "text-slate-500",
          "dark:text-slate-500",
          "dark:text-slate-400"
        );
      }
      if (btnAuditMobile) {
        btnAuditMobile.classList.add("text-slate-400", "dark:text-slate-500");
        btnAuditMobile.classList.remove(
          "text-blue-600",
          "dark:text-blue-500",
          "nav-active"
        );
      }

      if (btnScanDesktop)
        btnScanDesktop.className =
          "p-4 bg-blue-600 border border-blue-500 text-white rounded-2xl shadow-lg transition-all hover:pr-8 group relative overflow-hidden flex justify-center items-center";
      if (btnAuditDesktop)
        btnAuditDesktop.className =
          "p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-2xl shadow-sm transition-all hover:pr-8 group relative overflow-hidden flex justify-center items-center";

      const input = document.getElementById("scannerInput");
      if (input) input.focus();
    };

    const switchToAudit = () => {
      if (tabAudit) {
        tabAudit.classList.remove("hidden");
        tabAudit.classList.add("flex");
      }
      if (tabScanner) {
        tabScanner.classList.add("hidden");
        tabScanner.classList.remove("flex");
      }

      if (btnAuditHeader)
        btnAuditHeader.className =
          "px-6 py-2 rounded-lg text-sm font-bold bg-rose-500 text-white dark:bg-rose-500/20 dark:text-rose-400 transition-all relative shadow-md dark:shadow-inner";
      if (btnScanHeader)
        btnScanHeader.className =
          "px-6 py-2 rounded-lg text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all";

      if (btnAuditMobile) {
        btnAuditMobile.classList.add(
          "text-blue-600",
          "dark:text-blue-500",
          "nav-active"
        );
        btnAuditMobile.classList.remove(
          "text-slate-400",
          "text-slate-500",
          "dark:text-slate-500",
          "dark:text-slate-400"
        );
      }
      if (btnScanMobile) {
        btnScanMobile.classList.add("text-slate-400", "dark:text-slate-500");
        btnScanMobile.classList.remove(
          "text-blue-600",
          "dark:text-blue-500",
          "nav-active"
        );
      }

      if (btnAuditDesktop)
        btnAuditDesktop.className =
          "p-4 bg-blue-600 border border-blue-500 text-white rounded-2xl shadow-lg transition-all hover:pr-8 group relative overflow-hidden flex justify-center items-center";
      if (btnScanDesktop)
        btnScanDesktop.className =
          "p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-2xl shadow-sm transition-all hover:pr-8 group relative overflow-hidden flex justify-center items-center";
    };

    [btnScanHeader, btnScanMobile, btnScanDesktop].forEach((btn) => {
      if (btn) btn.addEventListener("click", switchToScanner);
    });

    [btnAuditHeader, btnAuditMobile, btnAuditDesktop].forEach((btn) => {
      if (btn) btn.addEventListener("click", switchToAudit);
    });

    const filterContainer = document.getElementById("collision-filters");
    if (filterContainer) {
      filterContainer.addEventListener("click", (e) => {
        if (e.target.tagName === "BUTTON") {
          filterContainer.querySelectorAll("button").forEach((b) => {
            b.className =
              "px-4 py-1.5 rounded-lg text-[10px] md:text-xs font-bold transition-all bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700 shrink-0";
          });
          e.target.className =
            "px-4 py-1.5 rounded-lg text-[10px] md:text-xs font-bold transition-all bg-amber-500 text-amber-950 shadow-[0_0_10px_rgba(245,158,11,0.3)] shrink-0";
          this.activeCollisionFilter = e.target.dataset.type;
          this.renderCollisions();
        }
      });
    }

    const subColisiones = document.getElementById("subtab-colisiones");
    const subGs1 = document.getElementById("subtab-gs1");
    const panelColisiones = document.getElementById("panel-colisiones");
    const panelGs1 = document.getElementById("panel-gs1");

    if (subColisiones && subGs1 && panelColisiones && panelGs1) {
      subColisiones.addEventListener("click", () => {
        panelColisiones.classList.remove("hidden");
        panelColisiones.classList.add("flex");
        panelGs1.classList.remove("flex");
        panelGs1.classList.add("hidden");

        subColisiones.className =
          "flex-1 px-4 py-2 rounded-lg text-xs font-bold bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm transition-all";
        subGs1.className =
          "flex-1 px-4 py-2 rounded-lg text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all";
      });

      subGs1.addEventListener("click", () => {
        panelGs1.classList.remove("hidden");
        panelGs1.classList.add("flex");
        panelColisiones.classList.remove("flex");
        panelColisiones.classList.add("hidden");

        subGs1.className =
          "flex-1 px-4 py-2 rounded-lg text-xs font-bold bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-sm transition-all";
        subColisiones.className =
          "flex-1 px-4 py-2 rounded-lg text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all";
      });
    }
  }

populateAuditTab() {
    this.renderCollisions();

    // 1. Actualizar contadores internos (Móvil)
    const countCol = document.getElementById("count-colisiones");
    const countGs1 = document.getElementById("count-gs1");
    if (countCol) countCol.innerText = this.duplicates.length;
    if (countGs1) countGs1.innerText = this.gs1Errors.length;

    // ==========================================
    // 2. NUEVO: RECONEXIÓN DEL CONTADOR MAESTRO (GLOBO ROJO)
    // ==========================================
    const totalAlerts = this.duplicates.length + this.gs1Errors.length;
    document.querySelectorAll("#badge-audit").forEach((badge) => {
      if (totalAlerts > 0) {
        badge.innerText = totalAlerts > 99 ? "+99" : totalAlerts;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    });

    // 3. Renderizar lista de infracciones GS1
    const ulGs1 = document.getElementById("audit-gs1");
    if (ulGs1) {
      if (this.gs1Errors.length > 0) {
        ulGs1.innerHTML = this.gs1Errors
          .map(
            (e) => `
            <li class="border-b border-slate-200 dark:border-slate-800 pb-3 flex justify-between items-start transition-colors">
            <div>
                <p class="font-bold text-sm text-slate-700 dark:text-slate-200">${
                  e.desc
                }</p>
                <p class="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-1 font-semibold tracking-wide">ID: ${
                  e.id
                } | SKU: ${e.sku || "-"}</p>
            </div>
            <div class="text-right shrink-0 ml-2">
                <span class="font-mono font-bold text-[11px] text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/30 px-2 py-1 rounded-md border border-rose-200 dark:border-rose-700/50 block mb-1">${
                  e.barcode
                }</span>
                <span class="text-[9px] font-black text-rose-500 uppercase tracking-widest">${
                  e.validation.tag
                }</span>
            </div>
            </li>
        `
          )
          .join("");
      } else {
        ulGs1.innerHTML = `<li class="text-emerald-600 dark:text-emerald-500 font-bold text-sm text-center py-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-900/50 transition-colors">Todos los códigos GS1 analizados son válidos.</li>`;
      }
    }
  }

  renderCollisions() {
    const ulDup = document.getElementById("audit-duplicates");
    if (!ulDup) return;

    let targetDups = this.duplicates;

    if (this.activeCollisionFilter !== "ALL") {
      targetDups = this.duplicates.filter(
        (d) => d.type === this.activeCollisionFilter
      );
    }

    if (targetDups.length === 0) {
      ulDup.innerHTML = `<div class="text-emerald-600 dark:text-emerald-400 font-bold text-center py-5 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-100 dark:border-emerald-900/40 transition-colors">Sin colisiones detectadas en [${this.activeCollisionFilter}].</div>`;
      return;
    }

    const groupedDuplicates = targetDups.reduce((acc, curr) => {
      if (!acc[curr.type]) acc[curr.type] = [];
      acc[curr.type].push(curr);
      return acc;
    }, {});

    let htmlOutput = "";
    for (const [type, dups] of Object.entries(groupedDuplicates)) {
      htmlOutput += `
        <div class="mb-5 bg-slate-50 dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-800/50 shadow-sm dark:shadow-inner transition-colors">
          <h4 class="text-amber-600 dark:text-amber-400 font-black border-b border-amber-200/50 dark:border-amber-900/50 pb-2 mb-3 uppercase text-[10px] tracking-widest flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            Colisiones en [${type}]: ${dups.length} incidencias
          </h4>
          <ul class="space-y-3">
      `;

      htmlOutput += dups
        .map(
          (d) => `
        <li class="border-b border-slate-200 dark:border-slate-800 pb-3 last:border-0 list-none transition-colors">
          <span class="font-mono text-amber-700 dark:text-amber-300 font-bold bg-amber-100 dark:bg-amber-900/30 px-2.5 py-0.5 rounded shadow-sm border border-amber-200 dark:border-amber-800/50">[${d.key}]</span>
          <div class="ml-2 mt-2.5 space-y-1 text-xs">
            <p><span class="text-rose-600 dark:text-rose-400 font-mono font-bold">Ref 1: </span> <span class="text-slate-600 dark:text-slate-400 font-bold">ID: ${d.item1.id}</span> - ${d.item1.desc}</p>
            <p><span class="text-rose-600 dark:text-rose-400 font-mono font-bold">Ref 2: </span> <span class="text-slate-600 dark:text-slate-400 font-bold">ID: ${d.item2.id}</span> - ${d.item2.desc}</p>
          </div>
        </li>
      `
        )
        .join("");
      htmlOutput += `</ul></div>`;
    }
    ulDup.innerHTML = htmlOutput;
  }

  setupImageModal() {
    const modal = document.getElementById("image-modal");
    const modalImg = document.getElementById("modal-image");
    const closeBtn = document.getElementById("close-modal");

    if (!modal || !modalImg || !closeBtn) return;

    window.openImageModal = (src) => {
      if (!src) return;
      modalImg.src = src;
      modal.classList.remove("hidden");
      void modal.offsetWidth;
      modal.classList.remove("opacity-0");
      modalImg.classList.remove("scale-95");
      modalImg.classList.add("scale-100");
    };

    const closeModal = () => {
      modal.classList.add("opacity-0");
      modalImg.classList.remove("scale-100");
      modalImg.classList.add("scale-95");
      setTimeout(() => modal.classList.add("hidden"), 300);
    };

    closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden"))
        closeModal();
    });
  }

// ==========================================
  // INPUT INTELIGENTE Y NAVEGACIÓN POR TECLADO
  // ==========================================
  setupUI() {
    const btnRefreshDesktop = document.getElementById("btn-refresh-db");
    const btnRefreshMobile = document.getElementById("btn-refresh-db-nav");

    [btnRefreshDesktop, btnRefreshMobile].filter(Boolean).forEach(btn => {
      if(!btn.dataset.bound) {
        btn.dataset.bound = "true";
        btn.addEventListener("click", () => this.init(true));
      }
    });

    const input = document.getElementById("scannerInput");
    const suggBox = document.getElementById("suggestions-box");
    
    let currentFocus = -1; 

    if(!input || !suggBox) return;

    const setActive = (items) => {
      if (!items || items.length === 0) return;
      items.forEach(item => {
        item.classList.remove("bg-blue-50", "dark:bg-slate-800", "border-l-4", "border-blue-500");
      });
      if (currentFocus >= items.length) currentFocus = 0;
      if (currentFocus < 0) currentFocus = (items.length - 1);
      const activeItem = items[currentFocus];
      activeItem.classList.add("bg-blue-50", "dark:bg-slate-800", "border-l-4", "border-blue-500");
      activeItem.scrollIntoView({ block: "nearest" });
    };

 // ==========================================
    // AUTO-FOCUS INTELIGENTE CORREGIDO
    // ==========================================
    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !suggBox.contains(e.target)) {
        suggBox.classList.add("hidden");
        
        // Verificamos si el clic fue en elementos de formulario interactivos
        const isFormElement = ["INPUT", "BUTTON", "TEXTAREA", "SELECT"].includes(e.target.tagName);
        // Verificamos si el usuario está interactuando dentro del modal de edición
        const isInsideModal = e.target.closest("#edit-modal") || e.target.closest(".modal");
        
        // Si NO es un elemento de formulario, NO está en el modal, NO es el panel glass, y la cámara está apagada...
        // Entonces devolvemos el foco al buscador principal.
        if (!isFormElement && !isInsideModal && !e.target.closest(".glass-panel") && !this.isCameraActive) {
           input.focus();
        }
      }
    });

    input.addEventListener("input", (e) => {
      const val = e.target.value.trim().toLowerCase();
      const btnScanner = document.getElementById("tab-btn-scanner");
      if (btnScanner && !btnScanner.classList.contains("text-blue-600") && !btnScanner.classList.contains("dark:text-blue-400")) {
        btnScanner.click();
      }

      currentFocus = -1;

      if (val.length < 2) {
        suggBox.classList.add("hidden");
        return;
      }

      const matches = this.rawDataset.filter((p) => {
        const searchString = `${p.desc || ""} ${p.sku || ""} ${p.alu || ""} ${p.barcode || ""} ${p.id || ""}`.toLowerCase();
        return searchString.includes(val);
      });

      if (matches.length > 0) {
        suggBox.innerHTML = matches.map((m) => `
          <li class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800" data-id="${m.id}">
            <div class="pointer-events-none">
              <p class="font-bold text-sm text-slate-700 dark:text-slate-200">${m.desc}</p>
              <p class="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">ID: ${m.id} | SKU: ${m.sku || "N/A"} | ALU: ${m.alu || "N/A"}</p>
            </div>
          </li>
        `).join("");
        suggBox.classList.remove("hidden");
      } else {
        suggBox.innerHTML = `<li class="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 italic">No hay resultados para: "${val}"</li>`;
        suggBox.classList.remove("hidden");
      }
    });

    suggBox.addEventListener("click", (e) => {
      const li = e.target.closest("li");
      if (li && li.dataset.id) {
        suggBox.classList.add("hidden");
        
        // Asesino de teclado (Truco readonly)
        input.setAttribute('readonly', 'readonly');
        input.blur();
        setTimeout(() => input.removeAttribute('readonly'), 300);

        this.processHybridScan(li.dataset.id);
      }
    });

    input.addEventListener("keydown", (e) => {
      const items = suggBox.querySelectorAll("li[data-id]");

      if (e.key === "ArrowDown") {
        e.preventDefault(); 
        currentFocus++;
        setActive(items);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        currentFocus--;
        setActive(items);
      } else if (e.key === "Enter") {
        e.preventDefault();
        
        if (currentFocus > -1 && items.length > 0 && !suggBox.classList.contains("hidden")) {
          items[currentFocus].click(); 
        } else {
          suggBox.classList.add("hidden");
          const rawScanValue = input.value.trim();
          if (rawScanValue) {
            // Asesino de teclado (Truco readonly)
            input.setAttribute('readonly', 'readonly');
            input.blur();
            setTimeout(() => input.removeAttribute('readonly'), 300);

            this.processHybridScan(rawScanValue);
          }
        }
      }
    });
  }

  // ==========================================
  // GESTIÓN DE CÁMARA
  // ==========================================
  setupCamera() {
    const container = document.getElementById("camera-container");
    if (!container || typeof Html5Qrcode === "undefined") return;

    this.html5QrCode = new Html5Qrcode("reader");
    const btnCamera = document.getElementById("btn-camera");
    const btnClose = document.getElementById("btn-close-camera");

    if (btnCamera) {
      btnCamera.addEventListener("click", (e) => {
        e.preventDefault();
        
        if (!this.isCameraActive) {
          
          // ==========================================
          // ASESINO DE TECLADOS VIRTUALES (NIVEL DIOS)
          // Forzamos al sistema operativo móvil a destruir el teclado
          // ==========================================
          const inputEl = document.getElementById("scannerInput");
          if (inputEl) {
            inputEl.setAttribute('readonly', 'readonly');
            inputEl.blur();
            setTimeout(() => inputEl.removeAttribute('readonly'), 300);
          }
          if (document.activeElement && document.activeElement.blur) {
             document.activeElement.blur();
          }

          // Activar UI Inmersiva
          container.classList.remove("hidden");
          container.classList.add("flex"); 
          document.body.classList.add("overflow-hidden"); 

          this.html5QrCode
            .start(
              { facingMode: "environment" },
              { fps: 15, qrbox: { width: 280, height: 200 } },
              (decodedText) => {
                this.stopCamera();
                this.processHybridScan(decodedText);
              },
              (errorMessage) => { /* Ignorado intencionalmente */ }
            )
            .then(() => {
              this.isCameraActive = true;
            })
            .catch((err) => {
              alert("Permiso de cámara denegado o dispositivo no soportado.");
              this.stopCamera(); 
            });
        }
      });
    }

    if (btnClose) {
      btnClose.addEventListener("click", () => this.stopCamera());
    }
  }

  stopCamera() {
    const container = document.getElementById("camera-container");
    if (container) {
      container.classList.add("hidden");
      container.classList.remove("flex");
    }
    document.body.classList.remove("overflow-hidden");

    if (this.isCameraActive && this.html5QrCode) {
      this.html5QrCode
        .stop()
        .then(() => {
          this.isCameraActive = false;
          // Ya NO enfocamos el input automáticamente para no reabrir el teclado
        })
        .catch((err) => console.error(err));
    }
  }

  // ==========================================
  // PIPELINE DE ESCANEO ACTIVO Y PARSEO
  // ==========================================
  processHybridScan(rawScanValue) {
    const resultBox = document.getElementById("active-result");
    const inputEl = document.getElementById("scannerInput");
    
    if (!resultBox) return;

    resultBox.classList.remove("scan-success", "scan-error");
    void resultBox.offsetWidth;

    // 1. MANTENER EL VALOR CRUDO EN EL INPUT (Requisito del usuario)
    if (inputEl) inputEl.value = rawScanValue;

    // 2. PARSEO: Extraer solo el código antes de la "U" o "|" para la búsqueda interna
    const scanValue = String(rawScanValue).split(/[U|]/)[0].trim();
    
    let isTextSearch = false;
    let product = this.hashData.get(scanValue);

    // Fallback extendido de búsqueda manual
    if (!product) {
      const lowerTerm = scanValue.toLowerCase();
      product = this.rawDataset.find((p) => {
        const searchString = `${p.desc || ""} ${p.sku || ""} ${p.alu || ""}`.toLowerCase();
        return searchString.includes(lowerTerm);
      });
      if (product) isTextSearch = true;
    }

    // Respuesta del Sistema
    if (product) {
      this.beep(800, 100);
      resultBox.classList.add("scan-success");
      this.renderActiveProduct(product, scanValue, isTextSearch);
      
      // Enviamos el valor crudo al historial para auditoría perfecta
      this.addToHistory(product, rawScanValue, true);
    } else {
      this.beep(300, 300);
      resultBox.classList.add("scan-error");
      this.renderError(rawScanValue); 
      this.addToHistory(null, rawScanValue, false);
    }
  }

  stopCamera() {
    const container = document.getElementById("camera-container");
    
    // Limpieza de clases inmersivas inmediatamente para mejor percepción de velocidad
    if (container) {
      container.classList.add("hidden");
      container.classList.remove("flex");
    }
    document.body.classList.remove("overflow-hidden");

    if (this.isCameraActive && this.html5QrCode) {
      this.html5QrCode
        .stop()
        .then(() => {
          this.isCameraActive = false;
          const input = document.getElementById("scannerInput");
          if (input) input.focus();
        })
        .catch((err) => console.error("Error deteniendo cámara:", err));
    }
  }

 
  renderActiveProduct(p, scanTerm, isTextSearch) {
    const container = document.getElementById("active-result");
    if (!container) return;

    const isBarcodeOk = p.validation.valid;

    const getImgUrl = (path) =>
      path
        ? path.startsWith("http")
          ? path
          : BASE_IMAGE_URL + encodeURIComponent(path)
        : null;
    const urlFront = getImgUrl(p.imagen);
    const urlBack = getImgUrl(p.posterior);
    const urlEtiqueta = getImgUrl(p.etiqueta);

    const buildImg = (url, alt) =>
      url
        ? `<img src="${url}" onclick="openImageModal('${url}')" alt="${alt}" class="w-full h-24 md:h-32 object-cover rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm img-zoomable hover:border-blue-500 bg-white dark:bg-slate-900 transition-colors">`
        : `<div class="w-full h-24 md:h-32 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 border-dashed flex flex-col items-center justify-center text-slate-500 dark:text-slate-600 text-[9px] font-black uppercase text-center p-2 transition-colors"><svg class="w-5 h-5 mb-1 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path></svg>Sin ${alt}</div>`;

    container.innerHTML = `
      <div class="w-full flex flex-col h-full gap-5 text-left animate-slide-up relative overflow-hidden">
        
        <div class="flex flex-col gap-2 shrink-0">
          <div class="flex justify-between items-start w-full">
            <div class="flex flex-wrap items-center gap-2">
              <span class="bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 px-2.5 py-1 rounded-lg text-[10px] md:text-xs font-black uppercase tracking-widest shadow-sm dark:shadow-inner transition-colors">ID: ${
                p.id || "N/A"
              }</span>
              <span class="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors">${
                p.cat || "Genérico"
              }</span>
              ${
                isTextSearch
                  ? '<span class="text-[9px] bg-indigo-50 dark:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-500/50 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-lg font-black uppercase tracking-widest shadow-sm transition-colors">Búsqueda Manual</span>'
                  : ""
              }
            </div>
            <span class="${
              isBarcodeOk
                ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/40"
                : "bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/40"
            } border px-3 py-1 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest shadow-sm whitespace-nowrap transition-colors">${
      p.validation.tag
    }</span>
          </div>
          <h2 class="text-2xl md:text-3xl lg:text-4xl font-black text-slate-900 dark:text-white leading-tight break-words pr-2 drop-shadow-sm mt-1 mb-2 transition-colors">${
            p.desc || "Sin Descripción Asignada"
          }</h2>
        </div>
        
        <div class="overflow-y-auto custom-scrollbar pr-2 flex flex-col gap-5 flex-1 relative z-10 pb-2">
          <div class="grid grid-cols-2 gap-3 shrink-0">
            <div class="bg-white dark:bg-slate-900/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm dark:shadow-inner group transition-all hover:shadow-md">
              <p class="text-[9px] text-slate-500 dark:text-slate-500 font-black uppercase tracking-widest mb-1 transition-colors">SKU Interno</p>
              <p class="text-base md:text-lg font-mono text-slate-800 dark:text-slate-200 font-bold transition-colors">${
                p.sku || "-"
              }</p>
            </div>
            <div class="bg-white dark:bg-slate-900/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-sm dark:shadow-inner group transition-all hover:shadow-md">
              <p class="text-[9px] text-slate-500 dark:text-slate-500 font-black uppercase tracking-widest mb-1 transition-colors">Código ALU</p>
              <p class="text-base md:text-lg font-mono text-slate-800 dark:text-slate-200 font-bold transition-colors">${
                p.alu || "-"
              }</p>
            </div>
            <div class="col-span-2 bg-white dark:bg-slate-900/60 p-4 rounded-2xl border ${
              scanTerm === String(p.barcode)
                ? "border-blue-400 dark:border-blue-500/60 shadow-[0_0_15px_rgba(37,99,235,0.15)] bg-blue-50/50 dark:bg-blue-900/10 ring-2 ring-blue-50"
                : "border-slate-200 dark:border-slate-700/50 shadow-sm dark:shadow-inner"
            } flex justify-between items-center group transition-all hover:shadow-md">
              <div class="flex flex-col">
                <p class="text-[9px] text-blue-600 dark:text-blue-500 font-black uppercase tracking-widest mb-1 flex items-center gap-1.5 transition-colors"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm14 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"></path></svg>EAN / UPC Principal</p>
                <p class="text-xl md:text-2xl font-mono text-slate-900 dark:text-slate-100 font-bold transition-colors">${
                  p.barcode || "-"
                }</p>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0 mt-2">
            <div class="bg-white dark:bg-slate-800/40 rounded-3xl p-5 border border-slate-200 dark:border-slate-700/50 flex-1 shadow-sm dark:shadow-inner relative overflow-hidden group hover:shadow-md transition-all">
              <div class="absolute -right-4 -top-4 w-16 h-16 bg-blue-500/10 dark:bg-blue-500/5 rounded-full blur-xl group-hover:bg-blue-500/20 dark:group-hover:bg-blue-500/10 transition-colors"></div>
              <h3 class="text-[10px] text-slate-500 dark:text-slate-400 font-black border-b border-slate-100 dark:border-slate-700/80 pb-3 uppercase tracking-widest mb-4 flex items-center gap-2"><svg class="w-4 h-4 text-blue-600 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg> Logística Operativa</h3>
              <div class="grid grid-cols-2 gap-x-3 gap-y-5">
                <div><p class="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mb-1 transition-colors">Layout Zona</p><p class="text-sm md:text-base font-black text-blue-600 dark:text-blue-400 transition-colors">${
                  p.layout || "-"
                }</p></div>
                <div><p class="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mb-1 transition-colors">Und. Medida</p><p class="text-sm md:text-base font-bold text-slate-800 dark:text-slate-200 transition-colors">${
                  p.um || "-"
                }</p></div>
                <div><p class="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mb-1 transition-colors">Peso Teórico</p><p class="text-sm md:text-base font-bold text-slate-800 dark:text-slate-200 transition-colors">${
                  p.peso ? p.peso + " KG" : "-"
                }</p></div>
                <div><p class="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mb-1 transition-colors">Und / Jaba</p><p class="text-sm md:text-base font-bold text-amber-600 dark:text-amber-400 transition-colors">${
                  p.undJaba || "-"
                }</p></div>
              </div>
            </div>
            
            <div class="bg-white dark:bg-slate-800/40 rounded-3xl p-5 border border-slate-200 dark:border-slate-700/50 flex-1 shadow-sm dark:shadow-inner relative overflow-hidden group hover:shadow-md transition-all">
              <div class="absolute -right-4 -top-4 w-16 h-16 bg-emerald-500/10 dark:bg-emerald-500/5 rounded-full blur-xl group-hover:bg-emerald-500/20 dark:group-hover:bg-emerald-500/10 transition-colors"></div>
              <h3 class="text-[10px] text-slate-500 dark:text-slate-400 font-black border-b border-slate-100 dark:border-slate-700/80 pb-3 uppercase tracking-widest mb-4 flex items-center gap-2"><svg class="w-4 h-4 text-emerald-600 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg> Control Sanitario</h3>
              <div class="grid grid-cols-1 gap-5">
                <div><p class="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mb-1.5 transition-colors">Reg. Sanitario DIGESA</p><p class="text-sm md:text-base font-mono font-bold text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/60 inline-block px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-inner transition-colors">${
                  p.rsa || "N/A"
                }</p></div>
                <div><p class="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mb-1 transition-colors">Vida Útil Restante</p><p class="text-base md:text-lg font-black text-emerald-600 dark:text-emerald-400 dark:drop-shadow-[0_0_5px_rgba(16,185,129,0.2)] transition-colors">${
                  p.diasUtil ? p.diasUtil + " Días" : "N/A"
                }</p></div>
              </div>
            </div>
          </div>

          <div class="bg-white dark:bg-slate-800/40 rounded-3xl p-5 border border-slate-200 dark:border-slate-700/50 shrink-0 shadow-sm dark:shadow-inner transition-colors">
            <h3 class="text-[10px] text-slate-500 dark:text-slate-400 font-black uppercase tracking-widest mb-3 flex items-center gap-2 transition-colors"><svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Declaración de Composición e Ingredientes</h3>
            <p class="text-xs md:text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-mono whitespace-pre-wrap transition-colors">${
              p.ingredientes || "Sin declaración sistemática."
            }</p>
          </div>

          <div class="grid grid-cols-3 gap-3 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shrink-0 mt-1 transition-colors">
            ${buildImg(urlFront, "Frontal")}
            ${buildImg(urlBack, "Posterior")}
            ${buildImg(urlEtiqueta, "Etiqueta")}
          </div>

          <div class="mt-2 shrink-0 pb-2">
             <button onclick="openEditModal('${
               p.id
             }')" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-sm py-4 rounded-2xl flex justify-center items-center gap-2 shadow-[0_5px_15px_rgba(37,99,235,0.25)] dark:shadow-[0_5px_20px_rgba(37,99,235,0.3)] transition-all active:scale-95 group">
                <svg class="w-5 h-5 group-hover:-translate-y-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                Actualizar Ficha Técnica
             </button>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================
  // HISTORIAL INTERACTIVO (CLICK TO RE-OPEN)
  // ==========================================
  addToHistory(product, scanTerm, success) {
    const historyContainer = document.getElementById("scan-history");
    if (!historyContainer) return;

    const time = new Date().toLocaleTimeString("es-PE", { hour12: false });
    const card = document.createElement("div");

    if (success) {
      card.className =
        "p-3 md:p-4 rounded-xl mb-2.5 border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/20 shadow-sm transition-all cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/80 group border-l-[4px] border-l-emerald-500 hover:shadow-md";
      card.onclick = () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
        this.processHybridScan(product.id);
      };

      card.innerHTML = `
        <div class="flex justify-between items-center mb-1">
          <span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">OK • ${time}</span>
          <span class="text-[9px] bg-slate-50 dark:bg-slate-900 px-2 py-0.5 rounded-md text-slate-500 dark:text-cyan-400 font-mono font-bold truncate max-w-[120px] border border-slate-200 dark:border-slate-800 group-hover:border-emerald-400 transition-colors">${scanTerm}</span>
        </div>
        <p class="text-sm font-black text-slate-800 dark:text-slate-100 truncate w-full transition-colors group-hover:text-emerald-600 dark:group-hover:text-emerald-400" title="${
          product.desc
        }">${product.desc}</p>
        <p class="text-[9px] text-slate-400 dark:text-slate-500 mt-1 uppercase tracking-widest font-black transition-colors">ZONA: <span class="text-blue-600 dark:text-blue-400">${
          product.layout || "N/A"
        }</span> <span class="mx-1 text-slate-300 dark:text-slate-600">/</span> ${
        product.cat || "Genérico"
      }</p>
      `;
    } else {
      card.className =
        "p-3 md:p-4 rounded-xl mb-2.5 border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/20 shadow-sm transition-all border-l-[4px] border-l-rose-500";
      card.innerHTML = `
        <div class="flex justify-between items-center mb-1.5">
          <span class="text-[10px] text-rose-500 dark:text-rose-400 font-bold uppercase tracking-wider transition-colors">ERROR • ${time}</span>
        </div>
        <p class="text-[10px] font-mono text-slate-700 dark:text-slate-500 font-bold w-full break-all bg-slate-50 dark:bg-slate-900 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800/80 shadow-inner transition-colors">${scanTerm}</p>
      `;
    }

    historyContainer.prepend(card);
    if (historyContainer.children.length > 50)
      historyContainer.lastChild.remove();
  }

  // ==========================================
  // GESTIÓN DE FORMULARIO CRUD E IMÁGENES
  // ==========================================
  setupEditForm() {
    const modal = document.getElementById("edit-modal");
    const form = document.getElementById("form-edit-product");
    const statusBox = document.getElementById("edit-status");
    const btnSave = document.getElementById("btn-save-edit");

    if (!modal || !form) return;

    const fileToBase64 = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = error => reject(error);
    });

    const handleLocalPreview = (inputId, previewId, placeholderId) => {
      const input = document.getElementById(inputId);
      if(input) {
        input.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
              const previewEl = document.getElementById(previewId);
              const placeholderEl = document.getElementById(placeholderId);
              if (previewEl && placeholderEl) {
                previewEl.src = e.target.result;
                previewEl.classList.remove('hidden');
                placeholderEl.classList.add('hidden');
              }
            };
            reader.readAsDataURL(file);
          }
        });
      }
    };

    handleLocalPreview('edit-img-frontal', 'edit-preview-frontal', 'edit-placeholder-frontal');
    handleLocalPreview('edit-img-posterior', 'edit-preview-posterior', 'edit-placeholder-posterior');
    handleLocalPreview('edit-img-etiqueta', 'edit-preview-etiqueta', 'edit-placeholder-etiqueta');

    const setupPreview = (imgId, placeholderId, url) => {
      const imgEl = document.getElementById(imgId);
      const placeEl = document.getElementById(placeholderId);
      if (imgEl && placeEl) {
        if (url) {
          imgEl.src = url;
          imgEl.classList.remove('hidden');
          placeEl.classList.add('hidden');
        } else {
          imgEl.src = '';
          imgEl.classList.add('hidden');
          placeEl.classList.remove('hidden');
        }
      }
    };

    window.openEditModal = (productId) => {
      const p = this.rawDataset.find(item => String(item.id) === String(productId));
      if (!p) return;

      document.getElementById('edit-id').value = p.id;
      const titleEl = document.getElementById('edit-modal-title');
      if(titleEl) titleEl.innerText = `ID: ${p.id}`;
      
      document.getElementById('edit-desc').value = p.desc || '';
      document.getElementById('edit-sku').value = p.sku || '';
      document.getElementById('edit-alu').value = p.alu || '';
      document.getElementById('edit-barcode').value = p.barcode || '';
      document.getElementById('edit-cat').value = p.cat || '';
      document.getElementById('edit-gestion').value = p.gestion || '';
      document.getElementById('edit-um').value = p.um || '';
      document.getElementById('edit-peso').value = p.peso || '';
      document.getElementById('edit-jaba').value = p.undJaba || '';
      document.getElementById('edit-layout').value = p.layout || '';
      document.getElementById('edit-rsa').value = p.rsa || '';
      document.getElementById('edit-dias').value = p.diasUtil || '';
      document.getElementById('edit-ingredientes').value = p.ingredientes || '';
      
      const getImgUrl = (path) => path ? (path.startsWith("http") ? path : BASE_IMAGE_URL + encodeURIComponent(path)) : null;

      // Restablecer inputs file y limpiar previews con los valores guardados
      const resetFileInput = (inputId, previewId, placeholderId, path) => {
        const inputEl = document.getElementById(inputId);
        if(inputEl) inputEl.value = "";
        setupPreview(previewId, placeholderId, getImgUrl(path));
      };

      resetFileInput("edit-img-frontal", "edit-preview-frontal", "edit-placeholder-frontal", p.imagen);
      resetFileInput("edit-img-posterior", "edit-preview-posterior", "edit-placeholder-posterior", p.posterior);
      resetFileInput("edit-img-etiqueta", "edit-preview-etiqueta", "edit-placeholder-etiqueta", p.etiqueta);

      if(statusBox) statusBox.classList.add('hidden');
      
      modal.classList.remove("hidden");
      void modal.offsetWidth; 
      modal.classList.remove("opacity-0");
    };

    const closeEdit = () => {
      if(modal) {
          modal.classList.add("opacity-0");
          setTimeout(() => modal.classList.add("hidden"), 300);
      }
      
      // Limpiamos los values del formulario internamente para no dejar rastro
      const fileInputs = ['edit-img-frontal', 'edit-img-posterior', 'edit-img-etiqueta'];
      fileInputs.forEach(id => {
          const el = document.getElementById(id);
          if(el) el.value = '';
      });
    };

    const btnCloseEdit = document.getElementById("btn-close-edit");
    const btnCancelEdit = document.getElementById("btn-cancel-edit");
    if(btnCloseEdit) btnCloseEdit.addEventListener("click", closeEdit);
    if(btnCancelEdit) btnCancelEdit.addEventListener("click", closeEdit);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // ==========================================
      // 1. SISTEMA ANTICOLISIONES (VALIDACIÓN)
      // ==========================================
      const idProd = document.getElementById("edit-id").value;
      const newSku = document.getElementById("edit-sku").value.trim();
      const newAlu = document.getElementById("edit-alu").value.trim();
      const newBarcode = document.getElementById("edit-barcode").value.trim();

      let collisionMsg = null;

      // Iteramos la base de datos en memoria buscando duplicados
      for (const p of this.rawDataset) {
        // Ignoramos el producto actual que estamos editando
        if (String(p.id) === String(idProd)) continue;

        // Comprobamos si el código ingresado coincide con otro existente (ignorando vacíos y guiones)
        const isInvalid = (val) => !val || val === "-" || val === "0" || val === "N/A" || val === "NA";

        if (!isInvalid(newSku) && String(p.sku) === newSku) {
          collisionMsg = `El SKU "${newSku}" ya pertenece al ID: ${p.id} (${p.desc})`;
          break;
        }
        if (!isInvalid(newAlu) && String(p.alu) === newAlu) {
          collisionMsg = `El ALU "${newAlu}" ya pertenece al ID: ${p.id} (${p.desc})`;
          break;
        }
        if (!isInvalid(newBarcode) && String(p.barcode) === newBarcode) {
          collisionMsg = `El BARCODE "${newBarcode}" ya pertenece al ID: ${p.id} (${p.desc})`;
          break;
        }
      }

      // Si existe colisión, detenemos el guardado y alertamos al operario
      if (collisionMsg) {
        if (statusBox) {
          statusBox.className = "md:col-span-3 text-center text-[11px] uppercase tracking-widest py-3 rounded-xl bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/50 dark:text-amber-400 dark:border-amber-500/50 transition-colors";
          statusBox.innerText = `⚠️ Acción Denegada: ${collisionMsg}`;
          statusBox.classList.remove("hidden");
        }
        return; // Interrumpe la ejecución aquí
      }
      
      if(btnSave) {
          btnSave.disabled = true;
          btnSave.innerHTML = `<svg class="animate-spin h-4 w-4 text-white inline-block mr-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Sincronizando...`;
      }

      try {
        const updates = {
          'DESCRIPCION': document.getElementById('edit-desc').value,
          'SKU': newSku,
          'ALU': newAlu,
          'BARCODE': newBarcode,
          'CATEGORIA': document.getElementById('edit-cat').value,
          'GESTION': document.getElementById('edit-gestion').value,
          'UM': document.getElementById('edit-um').value,
          'PESO PROM': document.getElementById('edit-peso').value,
          'UNDS X JABA': document.getElementById('edit-jaba').value,
          'LAYOUT': document.getElementById('edit-layout').value,
          'RSA': document.getElementById('edit-rsa').value,
          'DIAS UTIL': document.getElementById('edit-dias').value,
          'INGREDIENTES': document.getElementById('edit-ingredientes').value
        };

        const fFrontal = document.getElementById('edit-img-frontal')?.files[0];
        const fPosterior = document.getElementById('edit-img-posterior')?.files[0];
        const fEtiqueta = document.getElementById('edit-img-etiqueta')?.files[0];
        const timestamp = new Date().getTime(); 

        if (fFrontal) updates['IMAGEN'] = { name: `${idProd}.IMAGEN.${timestamp}.jpg`, mimeType: fFrontal.type, base64: await fileToBase64(fFrontal) };
        if (fPosterior) updates['POSTERIOR'] = { name: `${idProd}.POSTERIOR.${timestamp}.jpg`, mimeType: fPosterior.type, base64: await fileToBase64(fPosterior) };
        if (fEtiqueta) updates['ETIQUETA'] = { name: `${idProd}.ETIQUETA.${timestamp}.jpg`, mimeType: fEtiqueta.type, base64: await fileToBase64(fEtiqueta) };

        const response = await fetch(GAS_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
          body: JSON.stringify({ id: idProd, updates })
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
          if(statusBox) {
              statusBox.className = "md:col-span-3 text-center text-[11px] uppercase tracking-widest py-3 rounded-xl bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-400 dark:border-emerald-500/50 transition-colors";
              statusBox.innerText = "Guardado Exitoso • Refrescando matriz";
              statusBox.classList.remove('hidden');
          }
          
          setTimeout(() => {
            closeEdit();
            this.init(true); 
          }, 1500);

        } else throw new Error(result.message);

      } catch (err) {
        if(statusBox) {
            statusBox.className = "md:col-span-3 text-center text-[11px] uppercase tracking-widest py-3 rounded-xl bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-900/50 dark:text-rose-400 dark:border-rose-500/50 transition-colors";
            statusBox.innerText = `Error: ${err.message}`;
            statusBox.classList.remove('hidden');
        }
      } finally {
        if(btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = `Sincronizar a Base de Datos`;
        }
      }
    });
  }
  

  renderError(scanValue) {
    const container = document.getElementById("active-result");
    if (!container) return;

    container.innerHTML = `
      <div class="text-rose-600 flex flex-col items-center h-full justify-center text-center animate-pop-in transition-colors">
        <svg class="w-16 h-16 md:w-20 md:h-20 mb-3 opacity-90 drop-shadow-sm dark:drop-shadow-[0_0_15px_rgba(244,63,94,0.4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
        <h2 class="text-xl md:text-2xl font-black uppercase tracking-widest text-slate-800 dark:text-slate-200 transition-colors">No Accesible</h2>
        <div class="mt-4 w-full">
          <p class="text-slate-900 dark:text-white font-mono text-lg md:text-xl bg-rose-50 dark:bg-slate-950 border border-rose-200 dark:border-slate-800 px-6 py-4 rounded-2xl shadow-sm dark:shadow-inner inline-block break-all max-w-[95%] transition-colors">
            ${scanValue}
          </p>
        </div>
        <p class="text-xs font-medium mt-5 text-slate-500 max-w-[85%] mx-auto leading-relaxed transition-colors">No existe registro activo para esta cadena, SKU o Descripción.</p>
      </div>
    `;
  }

  showSystemError(err) {
    const status = document.getElementById("system-status");
    if (status) {
      status.className =
        "px-6 py-2 rounded-full bg-rose-100 dark:bg-rose-900/40 text-xs font-bold text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-500/50 shadow-sm dark:shadow-[0_0_15px_rgba(244,63,94,0.3)] transition-colors";
      status.innerText = "Fallo Conexión Endpoint";
    }
    console.error("GenFiler Architecture Error:", err);
  }

  beep(freq, duration) {
    if (!this.audioCtx) return;
    const oscillator = this.audioCtx.createOscillator();
    const gainNode = this.audioCtx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = freq;
    oscillator.connect(gainNode);
    gainNode.connect(this.audioCtx.destination);
    oscillator.start();
    setTimeout(() => oscillator.stop(), duration);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new ScannerStation();
});
