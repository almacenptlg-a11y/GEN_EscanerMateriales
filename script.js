/**
 * @fileoverview GenFiler Scanner Station - Application Core
 * @author Senior Full-Stack Engineer
 */

const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxLBQ40gDuBCPCVl1Jr1woBlqf2aLjm79imBLkREIyCfTAlkt1h6R7ACadIpZBiq6Tv/exec";
const BASE_IMAGE_URL = "https://www.appsheet.com/template/gettablefileurl?appName=4a927982-17f8-4eac-92c2-f2d644cf7d51&tableName=MATERIALES&fileName=";

class BarcodeEngine {
  static validate(code) {
    const str = String(code).trim();
    if (!str) return { valid: false, tag: "Sin Código Lector" };
    if (!/^\d+$/.test(str)) return { valid: false, tag: "Inválido (Alfanumérico)" };
    if (str.length !== 13 && str.length !== 12 && str.length !== 8) return { valid: false, tag: `Long. Anómala (${str.length})` };

    const padded = str.length === 12 ? "0" + str : str;
    const digits = padded.split("").map(Number);
    const checksum = digits.pop();
    let sum = 0;

    if (padded.length === 13) digits.forEach((d, i) => (sum += d * (i % 2 === 0 ? 1 : 3)));
    else if (padded.length === 8) digits.forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)));

    const expected = (10 - (sum % 10)) % 10;
    return expected === checksum ? { valid: true, tag: "GS1 Correcto" } : { valid: false, tag: `Error CheckDigit (Esp: ${expected})` };
  }
}

class ScannerStation {
  constructor() {
    this.hashData = new Map();
    this.rawDataset = [];
    this.duplicates = [];
    this.gs1Errors = [];
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    this.html5QrCode = null;
    this.isCameraActive = false;
    this.activeCollisionFilter = "ALL";

    this.init();
  }

  async init(forceRefresh = false) {
    try {
      const status = document.getElementById("system-status");
      const btnRefresh = document.getElementById("btn-refresh-db");

      status.className = "px-4 py-2 rounded-full bg-slate-800 text-xs font-bold text-amber-400 border border-amber-400/30 skeleton";
      status.innerText = forceRefresh ? "Forzando Sincronización..." : "Conectando a DB...";
      if (btnRefresh) btnRefresh.classList.add("animate-spin");

      const url = forceRefresh ? `${GAS_API_URL}?refresh=true` : GAS_API_URL;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Falla de red o Endpoint GAS no disponible.");
      const data = await response.json();

      this.hashData.clear();
      this.duplicates = [];
      this.gs1Errors = [];
      this.rawDataset = data.data;
      
      this.buildDataGraph(this.rawDataset);
      this.setupUI();
      this.setupCamera();
      this.setupTabs();
      this.populateAuditTab();
      this.setupImageModal();
      this.setupEditForm();

      if (btnRefresh) btnRefresh.classList.remove("animate-spin");
    } catch (err) {
      this.showSystemError(err);
      const btnRefresh = document.getElementById("btn-refresh-db");
      if (btnRefresh) btnRefresh.classList.remove("animate-spin");
    }
  }

  buildDataGraph(dataset) {
    dataset.forEach((item) => {
      const codes = [
        { type: "ID_PRDC", val: String(item.id || "").trim() },
        { type: "SKU", val: String(item.sku || "").trim() },
        { type: "ALU", val: String(item.alu || "").trim() },
        { type: "BARCODE", val: String(item.barcode || "").trim() }
      ].filter((c) => {
        const v = c.val.toUpperCase();
        return v.length > 0 && v !== "-" && v !== "0" && v !== "N/A" && v !== "NA" && v !== "NULL";
      });

      item.validation = BarcodeEngine.validate(item.barcode);
      if (!item.validation.valid && item.barcode) {
        const b = String(item.barcode).trim().toUpperCase();
        if (b.length > 0 && b !== "-" && b !== "0" && b !== "N/A") this.gs1Errors.push(item);
      }

      codes.forEach((codeObj) => {
        if (this.hashData.has(codeObj.val)) {
          const existingItem = this.hashData.get(codeObj.val);
          if (existingItem.id !== item.id) {
            this.duplicates.push({ type: codeObj.type, key: codeObj.val, item1: existingItem, item2: item });
          }
        } else {
          this.hashData.set(codeObj.val, item);
        }
      });
    });

    const status = document.getElementById("system-status");
    status.className = "px-6 py-2 rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-500/50 text-xs font-bold shadow-[0_0_15px_rgba(16,185,129,0.2)]";
    status.innerText = `En Línea: ${dataset.length} Productos Cargados`;
  }

  setupTabs() {
    const btnScanner = document.getElementById("tab-btn-scanner");
    const btnAudit = document.getElementById("tab-btn-audit");
    const tabScanner = document.getElementById("tab-scanner");
    const tabAudit = document.getElementById("tab-audit");

    const totalAlerts = this.duplicates.length + this.gs1Errors.length;
    if (totalAlerts > 0) {
      const badge = document.getElementById("badge-audit");
      badge.innerText = totalAlerts > 99 ? "+99" : totalAlerts;
      badge.classList.remove("hidden");
    }

    btnScanner.addEventListener("click", () => {
      tabScanner.classList.remove("hidden");
      tabAudit.classList.add("hidden");
      tabAudit.classList.remove("flex");
      btnScanner.className = "px-6 py-2 rounded-lg text-sm font-bold bg-emerald-500/20 text-emerald-400 transition-all";
      btnAudit.className = "px-6 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-slate-200 transition-all relative";
      document.getElementById("scannerInput").focus();
    });

    btnAudit.addEventListener("click", () => {
      tabAudit.classList.remove("hidden");
      tabAudit.classList.add("flex");
      tabScanner.classList.add("hidden");
      btnAudit.className = "px-6 py-2 rounded-lg text-sm font-bold bg-rose-500/20 text-rose-400 transition-all relative shadow-inner";
      btnScanner.className = "px-6 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-slate-200 transition-all";
    });

    const filterContainer = document.getElementById("collision-filters");
    if (filterContainer) {
      filterContainer.addEventListener("click", (e) => {
        if (e.target.tagName === "BUTTON") {
          filterContainer.querySelectorAll("button").forEach((b) => {
            b.className = "px-4 py-1.5 rounded-lg text-[10px] md:text-xs font-bold transition-all bg-slate-800 text-slate-400 hover:bg-slate-700";
          });
          e.target.className = "px-4 py-1.5 rounded-lg text-[10px] md:text-xs font-bold transition-all bg-amber-500 text-amber-950 shadow-[0_0_10px_rgba(245,158,11,0.3)]";
          this.activeCollisionFilter = e.target.dataset.type;
          this.renderCollisions();
        }
      });
    }
  }

  populateAuditTab() {
    this.renderCollisions();
    const ulGs1 = document.getElementById("audit-gs1");
    if (this.gs1Errors.length > 0) {
      ulGs1.innerHTML = this.gs1Errors.map((e) => `
        <li class="border-b border-slate-700/50 pb-3 flex justify-between items-start">
          <div>
            <p class="font-bold text-slate-200">${e.desc}</p>
            <p class="text-xs text-slate-500 font-mono mt-1">ID: ${e.id} | SKU: ${e.sku || "-"}</p>
          </div>
          <div class="text-right">
            <span class="font-mono text-rose-400 bg-rose-900/30 px-2 py-1 rounded border border-rose-700/50 block mb-1">${e.barcode}</span>
            <span class="text-[10px] text-rose-500 uppercase">${e.validation.tag}</span>
          </div>
        </li>
      `).join("");
    } else {
      ulGs1.innerHTML = `<li class="text-emerald-500 font-semibold text-center py-4 bg-emerald-900/20 rounded-lg border border-emerald-900/50">Todos los códigos GS1 analizados son válidos.</li>`;
    }
  }

  renderCollisions() {
    const ulDup = document.getElementById("audit-duplicates");
    let targetDups = this.duplicates;
    
    if (this.activeCollisionFilter !== "ALL") {
      targetDups = this.duplicates.filter((d) => d.type === this.activeCollisionFilter);
    }

    if (targetDups.length === 0) {
      ulDup.innerHTML = `<li class="text-emerald-500 font-semibold text-center py-4 bg-emerald-900/20 rounded-lg border border-emerald-900/50">Sin colisiones detectadas en [${this.activeCollisionFilter}].</li>`;
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
        <div class="mb-5 bg-slate-900/80 p-3 rounded-xl border border-slate-700/50">
          <h4 class="text-amber-400 font-bold border-b border-amber-900/50 pb-2 mb-3 uppercase text-[10px] tracking-widest flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            Colisiones detectadas en [${type}]: ${dups.length} casos
          </h4>
          <ul class="space-y-3">
      `;

      htmlOutput += dups.map((d) => `
        <li class="border-b border-slate-800 pb-3 last:border-0 list-none">
          <span class="font-mono text-amber-300 font-bold bg-amber-900/30 px-2 py-0.5 rounded border border-amber-700/50">[${d.key}]</span>
          <div class="ml-2 mt-2 space-y-1 text-xs">
            <p><span class="text-rose-400 font-mono font-bold">Conflicto 1: </span> ID: ${d.item1.id} - ${d.item1.desc}</p>
            <p><span class="text-rose-400 font-mono font-bold">Conflicto 2: </span> ID: ${d.item2.id} - ${d.item2.desc}</p>
          </div>
        </li>
      `).join("");
      htmlOutput += `</ul></div>`;
    }
    ulDup.innerHTML = htmlOutput;
  }

  setupImageModal() {
    const modal = document.getElementById("image-modal");
    const modalImg = document.getElementById("modal-image");
    const closeBtn = document.getElementById("close-modal");

    window.openImageModal = (src) => {
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
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal(); });
  }

  setupCamera() {
    this.html5QrCode = new Html5Qrcode("reader");
    const btnCamera = document.getElementById("btn-camera");
    const btnClose = document.getElementById("btn-close-camera");
    const container = document.getElementById("camera-container");

    btnCamera.addEventListener("click", () => {
      if (!this.isCameraActive) {
        container.classList.remove("hidden");
        this.html5QrCode.start(
            { facingMode: "environment" },
            { fps: 15, qrbox: { width: 300, height: 150 } },
            (decodedText) => {
              this.stopCamera();
              this.processHybridScan(decodedText);
            },
            (errorMessage) => {}
          ).then(() => { this.isCameraActive = true; })
          .catch((err) => {
            alert("Permiso de cámara denegado.");
            container.classList.add("hidden");
          });
      }
    });
    btnClose.addEventListener("click", () => this.stopCamera());
  }

  stopCamera() {
    if (this.isCameraActive) {
      this.html5QrCode.stop().then(() => {
          document.getElementById("camera-container").classList.add("hidden");
          this.isCameraActive = false;
          document.getElementById("scannerInput").focus();
        }).catch((err) => console.error(err));
    }
  }

  setupUI() {
    const btnRefresh = document.getElementById("btn-refresh-db");
    if (btnRefresh && !btnRefresh.dataset.bound) {
      btnRefresh.dataset.bound = "true";
      btnRefresh.addEventListener("click", () => this.init(true));
    }

    const input = document.getElementById("scannerInput");
    const suggBox = document.getElementById("suggestions-box");

    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !suggBox.contains(e.target)) {
        suggBox.classList.add("hidden");
        if (e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON" && !e.target.closest(".glass-panel")) input.focus();
      }
    });

    input.addEventListener("input", (e) => {
      const val = e.target.value.trim().toLowerCase();
      if (val.length < 3) { suggBox.classList.add("hidden"); return; }

      const matches = this.rawDataset.filter((p) => p.desc && p.desc.toLowerCase().includes(val)).slice(0, 8);

      if (matches.length > 0) {
        suggBox.innerHTML = matches.map((m) => `
          <li class="px-4 py-3 border-b border-slate-700 flex justify-between items-center" data-id="${m.id}">
            <div class="pointer-events-none">
              <p class="font-bold text-sm text-slate-200">${m.desc}</p>
              <p class="text-[10px] text-slate-400 font-mono mt-0.5">ID: ${m.id} | SKU: ${m.sku || "N/A"}</p>
            </div>
          </li>
        `).join("");
        suggBox.classList.remove("hidden");
      } else {
        suggBox.innerHTML = `<li class="px-4 py-3 text-sm text-slate-500 italic">No hay resultados descriptivos para: "${val}"</li>`;
        suggBox.classList.remove("hidden");
      }
    });

    suggBox.addEventListener("click", (e) => {
      const li = e.target.closest("li");
      if (li && li.dataset.id) {
        input.value = "";
        suggBox.classList.add("hidden");
        this.processHybridScan(li.dataset.id);
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        suggBox.classList.add("hidden");
        const scanValue = input.value.trim();
        if (scanValue) this.processHybridScan(scanValue);
        input.value = "";
        input.focus();
      }
    });
  }

  processHybridScan(scanValue) {
    const resultBox = document.getElementById("active-result");
    resultBox.classList.remove("scan-success", "scan-error");
    void resultBox.offsetWidth; 

    let isTextSearch = false;
    let product = this.hashData.get(scanValue);

    if (!product) {
      const lowerTerm = scanValue.toLowerCase();
      product = this.rawDataset.find((p) => p.desc && p.desc.toLowerCase().includes(lowerTerm));
      if (product) isTextSearch = true;
    }

    if (product) {
      this.beep(800, 100);
      resultBox.classList.add("scan-success");
      this.renderActiveProduct(product, scanValue, isTextSearch);
      this.addToHistory(product, scanValue, true);
    } else {
      this.beep(300, 300);
      resultBox.classList.add("scan-error");
      this.renderError(scanValue);
      this.addToHistory(null, scanValue, false);
    }
  }

  renderActiveProduct(p, scanTerm, isTextSearch) {
    const container = document.getElementById("active-result");
    const isBarcodeOk = p.validation.valid;

    const getImgUrl = (path) => path ? (path.startsWith("http") ? path : BASE_IMAGE_URL + encodeURIComponent(path)) : null;
    const urlFront = getImgUrl(p.imagen);
    const urlBack = getImgUrl(p.posterior);
    const urlEtiqueta = getImgUrl(p.etiqueta);

    const buildImg = (url, alt) => url 
      ? `<img src="${url}" onclick="openImageModal('${url}')" alt="${alt}" class="w-full h-28 md:h-40 object-cover rounded-xl border border-slate-700 shadow-md img-zoomable hover:border-blue-400">`
      : `<div class="w-full h-28 md:h-40 bg-slate-900 rounded-xl border border-slate-700 border-dashed flex flex-col items-center justify-center text-slate-600 text-[10px] font-bold uppercase text-center p-2"><svg class="w-6 h-6 mb-1 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path></svg>Sin ${alt}</div>`;

    container.innerHTML = `
      <div class="w-full flex flex-col h-full gap-4 text-left overflow-y-auto pr-2 pb-4">
        
        <div class="flex justify-between items-start border-b border-slate-700 pb-3 shrink-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="bg-slate-800 text-slate-300 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-slate-700 shadow-sm">ID: ${p.id || "N/A"}</span>
            <span class="text-[10px] md:text-xs font-bold uppercase tracking-widest text-slate-300 bg-slate-800/50 px-2 py-1 rounded border border-slate-700/50">${p.cat || "SIN CATEGORÍA"}</span>
            <button onclick="openEditModal('${p.id}')" class="flex items-center gap-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white border border-blue-500/50 px-3 py-1 rounded-full text-[10px] md:text-xs font-bold uppercase transition-all shadow-[0_0_10px_rgba(59,130,246,0.2)]">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg> Editar Datos
            </button>
            ${isTextSearch ? '<span class="text-[10px] bg-indigo-900/50 border border-indigo-700 text-indigo-300 px-2 py-1 rounded-full font-bold shadow-sm">Búsqueda Textual</span>' : ""}
          </div>
          <span class="${isBarcodeOk ? "bg-emerald-900/50 text-emerald-400 border-emerald-500/50" : "bg-rose-900/50 text-rose-400 border-rose-500/50"} border px-4 py-1 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-widest shadow-sm ml-2">
            ${p.validation.tag}
          </span>
        </div>

        <h2 class="text-2xl md:text-4xl font-black text-white leading-tight shrink-0">${p.desc || "PRODUCTO SIN DESCRIPCIÓN"}</h2>
        
        <div class="grid grid-cols-3 gap-3 shrink-0">
          <div class="bg-slate-950/50 p-2 md:p-3 rounded-xl border border-slate-800"><p class="text-[10px] text-slate-500 uppercase font-bold">SKU</p><p class="text-sm md:text-base font-mono text-slate-200 mt-1">${p.sku || "-"}</p></div>
          <div class="bg-slate-950/50 p-2 md:p-3 rounded-xl border border-slate-800"><p class="text-[10px] text-slate-500 uppercase font-bold">ALU</p><p class="text-sm md:text-base font-mono text-slate-200 mt-1">${p.alu || "-"}</p></div>
          <div class="bg-slate-950/50 p-2 md:p-3 rounded-xl border ${scanTerm === String(p.barcode) ? "border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.2)] bg-emerald-950/20" : "border-slate-800"}"><p class="text-[10px] text-slate-500 uppercase font-bold">BARCODE</p><p class="text-sm md:text-base font-mono text-slate-200 mt-1">${p.barcode || "-"}</p></div>
        </div>

        <div class="grid grid-cols-3 gap-2 bg-slate-800/30 p-3 rounded-xl border border-slate-700/50 shrink-0">
          ${buildImg(urlFront, 'Frontal')}
          ${buildImg(urlBack, 'Posterior')}
          ${buildImg(urlEtiqueta, 'Etiqueta')}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
          <div class="bg-slate-800/30 rounded-xl p-4 border border-slate-700/50 flex-1"><h3 class="text-[10px] text-slate-400 font-bold border-b border-slate-700 pb-2 uppercase tracking-widest mb-3">Logística</h3><div class="grid grid-cols-2 gap-x-2 gap-y-4"><div><p class="text-[9px] text-slate-500 uppercase font-bold">Layout Zona</p><p class="text-xs md:text-sm font-semibold text-blue-400 mt-0.5">${p.layout || "-"}</p></div><div><p class="text-[9px] text-slate-500 uppercase font-bold">U. Medida</p><p class="text-xs md:text-sm font-semibold text-slate-200 mt-0.5">${p.um || "-"}</p></div><div><p class="text-[9px] text-slate-500 uppercase font-bold">Peso Meta</p><p class="text-xs md:text-sm font-semibold text-slate-200 mt-0.5">${p.peso ? p.peso + " KG" : "-"}</p></div><div><p class="text-[9px] text-slate-500 uppercase font-bold">Unds x Jaba</p><p class="text-xs md:text-sm font-semibold text-amber-400 mt-0.5">${p.undJaba || "-"}</p></div></div></div>
          <div class="bg-slate-800/30 rounded-xl p-4 border border-slate-700/50 flex-1"><h3 class="text-[10px] text-slate-400 font-bold border-b border-slate-700 pb-2 uppercase tracking-widest mb-3">Sanidad</h3><div class="grid grid-cols-2 gap-3"><div><p class="text-[9px] text-slate-500 uppercase font-bold">Reg. Sanitario</p><p class="text-xs md:text-sm font-mono font-bold text-slate-200 mt-1 bg-slate-900/50 inline-block px-2 py-1 rounded">${p.rsa || "N/A"}</p></div><div><p class="text-[9px] text-slate-500 uppercase font-bold">Caducidad Base</p><p class="text-xs md:text-sm font-bold mt-1 text-emerald-400">${p.diasUtil ? p.diasUtil + " Días" : "N/A"}</p></div></div></div>
        </div>

        <div class="bg-amber-950/20 rounded-xl p-4 border border-amber-900/30 mt-auto shrink-0">
          <h3 class="text-[10px] text-amber-500 font-bold uppercase tracking-widest mb-2 flex items-center gap-2"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg> Declaración de Ingredientes</h3>
          <p class="text-xs md:text-sm text-amber-200/80 leading-relaxed font-mono">${p.ingredientes || "Sin declaración."}</p>
        </div>
      </div>
    `;
  }

  setupEditForm() {
    const modal = document.getElementById("edit-modal");
    const form = document.getElementById("form-edit-product");
    const statusBox = document.getElementById("edit-status");
    const btnSave = document.getElementById("btn-save-edit");

    const fileToBase64 = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = error => reject(error);
    });

    window.openEditModal = (productId) => {
      const p = this.rawDataset.find(item => String(item.id) === String(productId));
      if (!p) return;

      document.getElementById('edit-id').value = p.id;
      document.getElementById('edit-modal-title').innerText = `ID: ${p.id}`;
      
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
      
      document.getElementById('edit-img-frontal').value = '';
      document.getElementById('edit-img-posterior').value = '';
      document.getElementById('edit-img-etiqueta').value = '';

      statusBox.classList.add('hidden');
      modal.classList.remove("hidden");
      void modal.offsetWidth; 
      modal.classList.remove("opacity-0");
    };

    const closeEdit = () => {
      modal.classList.add("opacity-0");
      setTimeout(() => modal.classList.add("hidden"), 300);
    };

    document.getElementById("btn-close-edit").addEventListener("click", closeEdit);
    document.getElementById("btn-cancel-edit").addEventListener("click", closeEdit);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      btnSave.disabled = true;
      btnSave.innerHTML = `<svg class="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Sincronizando...`;

      try {
        const idProd = document.getElementById('edit-id').value;
        const updates = {
          'DESCRIPCION': document.getElementById('edit-desc').value,
          'SKU': document.getElementById('edit-sku').value,
          'ALU': document.getElementById('edit-alu').value,
          'BARCODE': document.getElementById('edit-barcode').value,
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

        const fFrontal = document.getElementById('edit-img-frontal').files[0];
        const fPosterior = document.getElementById('edit-img-posterior').files[0];
        const fEtiqueta = document.getElementById('edit-img-etiqueta').files[0];
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
          statusBox.className = "md:col-span-3 text-center text-xs font-bold py-3 rounded bg-emerald-900/50 text-emerald-400 border border-emerald-500/50";
          statusBox.innerText = "¡Guardado exitoso! Refrescando...";
          statusBox.classList.remove('hidden');
          
          setTimeout(() => {
            closeEdit();
            this.init(true); 
            btnSave.disabled = false;
            btnSave.innerHTML = `Sincronizar a Google Sheets`;
          }, 1500);

        } else throw new Error(result.message);

      } catch (err) {
        statusBox.className = "md:col-span-3 text-center text-xs font-bold py-3 rounded bg-rose-900/50 text-rose-400 border border-rose-500/50";
        statusBox.innerText = `Error: ${err.message}`;
        statusBox.classList.remove('hidden');
        btnSave.disabled = false;
        btnSave.innerHTML = `Reintentar`;
      }
    });
  }

  renderError(scanValue) {
    const container = document.getElementById("active-result");
    container.innerHTML = `
      <div class="text-rose-500 flex flex-col items-center h-full justify-center text-center">
        <svg class="w-24 h-24 mb-4 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
        <h2 class="text-2xl md:text-3xl font-black uppercase tracking-wider">No Encontrado</h2>
        <p class="text-rose-300 mt-4 font-mono text-sm md:text-base bg-rose-950/50 px-6 py-3 rounded-xl border border-rose-800/50 shadow-inner">Lectura: <span class="font-bold">${scanValue}</span></p>
        <p class="text-xs mt-6 text-slate-400 max-w-sm">Este valor no coincide con ningún ID, SKU, ALU, BARCODE ni Descripción.</p>
      </div>
    `;
  }

  addToHistory(product, scanTerm, success) {
    const historyContainer = document.getElementById("scan-history");
    const time = new Date().toLocaleTimeString("es-PE", { hour12: false });
    const card = document.createElement("div");
    card.className = `p-3 rounded-lg mb-3 border-l-4 bg-slate-800/50 shadow-sm ${success ? "border-emerald-500" : "border-rose-500"}`;

    if (success) {
      card.innerHTML = `
        <div class="flex justify-between items-center mb-1">
          <span class="text-xs text-emerald-400 font-bold">OK - ${time}</span>
          <span class="text-[10px] bg-slate-700 px-2 py-0.5 rounded text-slate-300 font-mono truncate max-w-[100px] border border-slate-600">${scanTerm}</span>
        </div>
        <p class="text-sm font-semibold text-slate-200 truncate" title="${product.desc}">${product.desc}</p>
        <p class="text-[10px] text-slate-500 mt-1 uppercase">ZONA: ${product.layout || "N/A"} | ${product.cat || "N/A"}</p>
      `;
    } else {
      card.innerHTML = `
        <div class="flex justify-between items-center mb-1">
          <span class="text-xs text-rose-400 font-bold">ERROR - ${time}</span>
        </div>
        <p class="text-sm font-mono text-slate-400 truncate">${scanTerm}</p>
      `;
    }

    historyContainer.prepend(card);
    if (historyContainer.children.length > 50) historyContainer.lastChild.remove();
  }

  showSystemError(err) {
    const status = document.getElementById("system-status");
    status.className = "px-6 py-2 rounded-full bg-rose-900/40 text-xs font-bold text-rose-400 border border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.3)]";
    status.innerText = "Error de Endpoint. Verifique conexión.";
    console.error("GenFiler Architecture Error:", err);
  }

  beep(freq, duration) {
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
