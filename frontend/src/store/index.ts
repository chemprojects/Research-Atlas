import { create } from "zustand";
import type {
  Paper,
  DigestEntry,
  ResearchProfile,
  SystemStatus,
  OllamaModel,
  Source,
  HardwareInfo,
} from "../api/client";
import {
  fetchSystemStatus,
  fetchPapers,
  fetchDigest,
  fetchProfile,
  triggerScan,
  triggerFilter,
  stopScan,
} from "../api/client";

function clampPercent(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

// ── System Status Slice ────────────────────────────────────────────────────────

interface SystemStatusSlice {
  systemStatus: SystemStatus | null;
  systemStatusLoading: boolean;
  loadSystemStatus: () => Promise<void>;
  pollSystemStatus: () => () => void;
}

// ── Papers Slice ───────────────────────────────────────────────────────────────

interface PaperFilter {
  search: string;
  source: string;
  tier: string;
  sort: "relevance" | "date";
  dateFrom: string;
  dateTo: string;
}

interface PapersSlice {
  papers: Paper[];
  papersTotal: number;
  papersLoading: boolean;
  papersError: string | null;
  papersLastLoadedAt: number;
  papersLastFilterKey: string;
  paperFilter: PaperFilter;
  selectedPaper: Paper | null;
  loadPapers: (options?: { force?: boolean }) => Promise<void>;
  setPaperFilter: (filter: Partial<PaperFilter>) => void;
  setSelectedPaper: (paper: Paper | null) => void;
}

// ── Digest Slice ───────────────────────────────────────────────────────────────

interface DigestSlice {
  digest: DigestEntry | null;
  digestLoading: boolean;
  digestDate: string;
  loadDigest: (date?: string) => Promise<void>;
  setDigestDate: (date: string) => void;
}

// ── Profile Slice ──────────────────────────────────────────────────────────────

interface ProfileSlice {
  profile: ResearchProfile | null;
  profileLoading: boolean;
  loadProfile: () => Promise<void>;
  setProfile: (profile: ResearchProfile) => void;
}

// ── Models Slice ───────────────────────────────────────────────────────────────

interface ModelsSlice {
  models: OllamaModel[];
  modelsLoading: boolean;
  installingModels: Record<string, number>;
  setModels: (models: OllamaModel[]) => void;
  setInstallingModel: (name: string, progress: number) => void;
  clearInstallingModel: (name: string) => void;
}

// ── Sources Slice ──────────────────────────────────────────────────────────────

interface SourcesSlice {
  sources: Source[];
  sourcesLoading: boolean;
  setSources: (sources: Source[]) => void;
}

// ── Hardware Slice ─────────────────────────────────────────────────────────────

interface HardwareSlice {
  hardware: HardwareInfo | null;
  hardwareLoading: boolean;
  setHardware: (hw: HardwareInfo) => void;
}

// ── Scan Slice ─────────────────────────────────────────────────────────────────

interface ScanSlice {
  scanRunning: boolean;
  scanMode: "idle" | "scan" | "filter";
  scanProgress: number;
  scanMessage: string;
  lastScanTime: string | null;
  runScan: (options?: { llm_model?: string; embedding_model?: string; from_date?: string; to_date?: string }) => Promise<void>;
  runFilter: (options?: { llm_model?: string; embedding_model?: string }) => Promise<void>;
  stopScanRun: () => Promise<void>;
}

// ── Combined Store ─────────────────────────────────────────────────────────────

type AppStore = SystemStatusSlice &
  PapersSlice &
  DigestSlice &
  ProfileSlice &
  ModelsSlice &
  SourcesSlice &
  HardwareSlice &
  ScanSlice;

export const useAppStore = create<AppStore>((set, get) => ({
  // ── System Status ──────────────────────────────────────────────────────────
  systemStatus: null,
  systemStatusLoading: false,

  loadSystemStatus: async () => {
    set({ systemStatusLoading: true });
    try {
      const status = await fetchSystemStatus();
      const progress = status.scan_progress;
      set((state) => ({
        systemStatus: status,
        systemStatusLoading: false,
        scanRunning: Boolean(status.scan_running),
        scanMode:
          progress?.mode === "scan" || progress?.mode === "filter"
            ? progress.mode
            : (Boolean(status.scan_running) ? (state.scanMode === "idle" ? "scan" : state.scanMode) : "idle"),
        scanProgress: Boolean(status.scan_running) ? clampPercent(progress?.percent) : 0,
        scanMessage: Boolean(status.scan_running) ? String(progress?.message ?? "") : "",
      }));
    } catch {
      const prev = get().systemStatus;
      if (prev) {
        // Keep last known-good status on transient failures (e.g., heavy scan load)
        // so the UI does not flap into offline/remount loops.
        set({ systemStatusLoading: false });
      } else {
        set({
          systemStatusLoading: false,
          systemStatus: {
            ...MOCK_STATUS,
            backend_ready: false,
            ollama_running: false,
            ollama_installed: false,
            current_llm: undefined,
            current_embedding: undefined,
          },
        });
      }
    }
  },

  pollSystemStatus: () => {
    const { loadPapers, loadDigest } = get();
    let stopped = false;
    let bootRetries = 0;
    const maxBootRetries = 30; // ~30s total at 1s retry cadence
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let prevRunning = Boolean(get().scanRunning);

    const schedule = () => {
      if (stopped) return;
      const state = get();
      const backendReady = state.systemStatus?.backend_ready === true;
      const isRunning = Boolean(state.scanRunning);
      let delay = isRunning ? 1200 : 15000;
      if (!backendReady && bootRetries < maxBootRetries) {
        delay = 1000;
      }
      timer = setTimeout(() => {
        void tick();
      }, delay);
    };

    const tick = async () => {
      if (stopped || inFlight) {
        schedule();
        return;
      }
      inFlight = true;
      try {
        const status = await fetchSystemStatus();
        const progress = status.scan_progress;
        const nowRunning = Boolean(status.scan_running);
        const ready = status.backend_ready === true;

        set((state) => ({
          systemStatus: status,
          systemStatusLoading: false,
          scanRunning: nowRunning,
          scanMode:
            progress?.mode === "scan" || progress?.mode === "filter"
              ? progress.mode
              : (nowRunning ? (state.scanMode === "idle" ? "scan" : state.scanMode) : "idle"),
          scanProgress: nowRunning ? clampPercent(progress?.percent) : 0,
          scanMessage: nowRunning ? String(progress?.message ?? "") : "",
          lastScanTime:
            prevRunning && !nowRunning ? new Date().toISOString() : state.lastScanTime,
        }));

        if (prevRunning && !nowRunning) {
          void loadPapers({ force: true });
          void loadDigest();
        }
        prevRunning = nowRunning;
        bootRetries = ready ? 0 : Math.min(maxBootRetries, bootRetries + 1);
      } catch {
        const prev = get().systemStatus;
        if (!prev) {
          set({
            systemStatus: {
              ...MOCK_STATUS,
              backend_ready: false,
              ollama_running: false,
              ollama_installed: false,
              current_llm: undefined,
              current_embedding: undefined,
            },
            systemStatusLoading: false,
          });
        } else {
          set({ systemStatusLoading: false });
        }
      } finally {
        inFlight = false;
        schedule();
      }
    };

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  },

  // ── Papers ─────────────────────────────────────────────────────────────────
  papers: [],
  papersTotal: 0,
  papersLoading: false,
  papersError: null,
  papersLastLoadedAt: 0,
  papersLastFilterKey: "",
  paperFilter: {
    search: "",
    source: "",
    tier: "",
    sort: "relevance",
    dateFrom: "",
    dateTo: "",
  },
  selectedPaper: null,

  loadPapers: async (options) => {
    const force = options?.force === true;
    const { paperFilter } = get();
    const filterKey = JSON.stringify(paperFilter);
    const { papersLoading, papersLastLoadedAt, papersLastFilterKey } = get();
    const now = Date.now();
    if (!force && papersLoading) return;
    if (!force && papersLastFilterKey === filterKey && now - papersLastLoadedAt < 15000) {
      return;
    }
    set({ papersLoading: true, papersError: null });
    try {
      const result = await fetchPapers({
        search: paperFilter.search || undefined,
        source: paperFilter.source || undefined,
        tier: paperFilter.tier || undefined,
        sort: paperFilter.sort,
        date_from: paperFilter.dateFrom || undefined,
        date_to: paperFilter.dateTo || undefined,
        include_total: true,
      });
      set({
        papers: result.papers,
        papersTotal: result.total,
        papersLoading: false,
        papersLastLoadedAt: Date.now(),
        papersLastFilterKey: filterKey,
      });
    } catch (err) {
      set({ papersError: String(err), papersLoading: false });
    }
  },

  setPaperFilter: (filter) => {
    set((state) => ({ paperFilter: { ...state.paperFilter, ...filter } }));
    get().loadPapers({ force: true });
  },

  setSelectedPaper: (paper) => set({ selectedPaper: paper }),

  // ── Digest ─────────────────────────────────────────────────────────────────
  digest: null,
  digestLoading: false,
  digestDate: new Date().toISOString().split("T")[0],

  loadDigest: async (date) => {
    const digestDate = date ?? get().digestDate;
    set({ digestLoading: true, digestDate });
    try {
      const digest = await fetchDigest(digestDate);
      set({ digest, digestLoading: false });
    } catch {
      set({ digestLoading: false });
    }
  },

  setDigestDate: (date) => {
    set({ digestDate: date });
    get().loadDigest(date);
  },

  // ── Profile ────────────────────────────────────────────────────────────────
  profile: null,
  profileLoading: false,

  loadProfile: async () => {
    set({ profileLoading: true });
    try {
      const profile = await fetchProfile();
      set({ profile, profileLoading: false });
    } catch {
      set({ profileLoading: false });
    }
  },

  setProfile: (profile) => set({ profile }),

  // ── Models ───────────────────────────────────────────────────────────────────
  models: [],
  modelsLoading: false,
  installingModels: {},

  setModels: (models) => set({ models }),

  setInstallingModel: (name, progress) =>
    set((state) => ({
      installingModels: { ...state.installingModels, [name]: progress },
    })),

  clearInstallingModel: (name) =>
    set((state) => {
      const installingModels = { ...state.installingModels };
      delete installingModels[name];
      return { installingModels };
    }),

  // ── Sources ──────────────────────────────────────────────────────────────────
  sources: [],
  sourcesLoading: false,
  setSources: (sources) => set({ sources }),

  // ── Hardware ─────────────────────────────────────────────────────────────────
  hardware: null,
  hardwareLoading: false,
  setHardware: (hw) => set({ hardware: hw }),

  // ── Scan ─────────────────────────────────────────────────────────────────────
  scanRunning: false,
  scanMode: "idle",
  scanProgress: 0,
  scanMessage: "",
  lastScanTime: null,

  runScan: async (options) => {
    set({ scanRunning: true, scanMode: "scan", scanProgress: 2, scanMessage: "Starting scan..." });
    try {
      await triggerScan({
        embedding_model: options?.embedding_model,
        from_date: options?.from_date,
        to_date: options?.to_date,
      });
      void get().loadSystemStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan could not start";
      set({ scanRunning: false, scanMode: "idle", scanProgress: 0, scanMessage: message });
    }
  },

  runFilter: async (options) => {
    set({ scanRunning: true, scanMode: "filter", scanProgress: 2, scanMessage: "Starting AI filter..." });
    try {
      await triggerFilter(options);
      void get().loadSystemStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Filter could not start";
      set({ scanRunning: false, scanMode: "idle", scanProgress: 0, scanMessage: message });
    }
  },

  stopScanRun: async () => {
    try {
      await stopScan();
    } finally {
      set({ scanMessage: "Stopping scan..." });
    }
  },
}));

// ── Mock data helpers (used when backend is not connected) ─────────────────────

export const MOCK_PAPERS: Paper[] = [
  {
    id: "1",
    title: "Derivation of Morse potential",
    authors: ["Mirzanejad, A.", "Varganov, S. A."],
    journal: "Molecular Physics",
    published_date: "2024-05-22",
    doi: "10.1080/00268976.2024.2360542",
    abstract:
      "The Morse potential can be derived from a simple screened charge model that accounts for the shielding of nuclear charge by electron density. This work establishes connections between classical and quantum mechanical descriptions of chemical bonds through the screened charge framework.",
    summary:
      "Derives the Morse interatomic potential from a screened nuclear charge model, linking classical bond descriptions with quantum mechanical bonding.",
    why_it_matters:
      "Foundational potential-energy theory relevant to computational chemistry and spectroscopy.",
    methods: ["Screened charge model", "Quantum chemistry", "Potential energy surfaces"],
    keywords: ["Morse potential", "interatomic potential", "chemical bond", "screened charge"],
    source: "crossref",
    tier: "must_read",
    relevance_score: 97,
    feedback: null,
  },
  {
    id: "2",
    title:
      "Two-State Spin-Forbidden Formation of Amide Molecules in the Interstellar Medium",
    authors: ["Mirzanejad, A.", "Varganov, S. A."],
    journal: "ACS Earth and Space Chemistry",
    published_date: "2025-01-01",
    doi: "10.1021/acsearthspacechem.4c00240",
    abstract:
      "The C₂H₅NO isomers are the simplest family of molecules containing a peptide bond and therefore highly relevant to astrochemistry and astrobiology. We investigate formation mechanisms of C₂H₅NO amide isomers from precursors detected in the interstellar medium, focusing on reaction pathways involving two electronic states with different spin multiplicities. Density functional theory and high-level coupled cluster calculations identify barrierless two-state spin-forbidden pathways for forming acetamide, N-methylformamide, and acetimidic acid from acetaldehyde, imidogen, formamide, and methylene.",
    summary:
      "Computational study of spin-forbidden gas-phase routes to simple amide isomers in the interstellar medium, including acetamide and N-methylformamide.",
    why_it_matters:
      "Relevant to astrochemistry and prebiotic chemistry pathways for peptide-bond-containing species.",
    methods: ["DFT", "Coupled cluster", "Reaction pathway analysis"],
    keywords: [
      "interstellar medium",
      "amide",
      "spin-forbidden",
      "astrochemistry",
      "peptide bond",
    ],
    source: "crossref",
    tier: "must_read",
    relevance_score: 95,
    feedback: null,
  },
  {
    id: "3",
    title:
      "Converting Second-Order Saddle Points to Transition States: New Principles for the Design of 4π Photoswitches",
    authors: ["Mirzanejad, A.", "Muechler, L."],
    journal: "ChemPhysChem",
    published_date: "2024-01-01",
    doi: "10.1002/cphc.202400786",
    abstract:
      "Molecular photoswitches have demonstrated potential for storing solar energy at the molecular level. Development of efficient photoswitches is hindered by limitations in cyclability and optical properties. We demonstrate that limitations in electrocyclization-based photoswitches stem from competition between Woodward–Hoffmann allowed and forbidden pathways, and that second-order saddle points are crucial in dictating competition between disrotatory and conrotatory pathways. These insights suggest opportunities to manipulate pathway competition through geometric constraints.",
    summary:
      "Shows how second-order saddle points control competing conrotatory and disrotatory pathways in 4π photoswitch design.",
    why_it_matters:
      "Advances computational design principles for molecular photoswitches and solar-energy storage materials.",
    methods: ["Multireference methods", "Potential energy surfaces", "Photochemistry"],
    keywords: ["photoswitch", "saddle point", "transition state", "electrocyclization"],
    source: "crossref",
    tier: "possibly_relevant",
    relevance_score: 88,
    feedback: null,
  },
  {
    id: "4",
    title:
      "The role of the intermediate triplet state in iron-catalyzed multi-state C–H activation",
    authors: ["Mirzanejad, A.", "Varganov, S. A."],
    journal: "Phys. Chem. Chem. Phys.",
    published_date: "2022-08-05",
    doi: "10.1039/d2cp02733j",
    abstract:
      "The activation and functionalization of the C–H bond is a fundamental challenge in chemistry. Using a Fe(II)-based catalyst, we investigate reaction pathways with high-level electronic structure calculations. Our results highlight the role of an intermediate triplet state in a quintet–triplet–singlet reaction mechanism for C–H activation, which is more thermodynamically favorable than alternative pathways considered.",
    summary:
      "CCSD(T)-level analysis of Fe(II)-catalyzed C–H activation showing a quintet–triplet–singlet mechanism via an intermediate triplet state.",
    why_it_matters:
      "Illustrates multistate reactivity in iron catalysis relevant to C–H functionalization.",
    methods: ["CCSD(T)", "Multireference theory", "Reaction mechanisms"],
    keywords: ["C–H activation", "iron catalysis", "triplet state", "multistate reactivity"],
    source: "crossref",
    tier: "possibly_relevant",
    relevance_score: 85,
    feedback: null,
  },
  {
    id: "5",
    title: "Topological Transitions in Orbital-Symmetry-Controlled Chemical Reactions",
    authors: ["Xie, Z.", "Mirzanejad, A.", "Muechler, L."],
    journal: "arXiv preprint",
    published_date: "2025-06-23",
    doi: "10.48550/arXiv.2506.18984",
    external_id: "2506.18984",
    url: "https://arxiv.org/abs/2506.18984",
    abstract:
      "Topological band theory has transformed our understanding of crystalline materials by classifying the connectivity and crossings of electronic energy levels. Extending these concepts to molecular systems has attracted significant interest. Reactions governed by orbital symmetry conservation are ideal candidates. Here we introduce a Green's function formalism to classify orbital symmetry controlled reactions even in the presence of strong electronic correlations, focusing on prototypical 4π electrocyclizations.",
    summary:
      "Green's-function topology for symmetry-controlled electrocyclizations, including crossings of Green's function zeros on forbidden pathways.",
    why_it_matters:
      "Connects modern topological methods to correlated molecular reaction pathways.",
    methods: ["Green's functions", "Topological invariants", "Electrocyclization"],
    keywords: ["topology", "electrocyclization", "Green's function", "orbital symmetry"],
    source: "arxiv",
    tier: "must_read",
    relevance_score: 96,
    feedback: null,
  },
  {
    id: "6",
    title:
      "Computational evidence of a bifurcation in a Cope rearrangement proximate to a forbidden electrocyclization",
    authors: ["Mirzanejad, A.", "Muechler, L."],
    journal: "ChemRxiv",
    published_date: "2025-07-04",
    doi: "10.26434/chemrxiv-2025-0xsfn",
    url: "https://chemrxiv.org/doi/pdf/10.26434/chemrxiv-2025-0xsfn",
    abstract:
      "Bifurcations are important features on the potential energy surface of chemical reactions. Post-transition state bifurcations (PTSB) are increasingly observed in pathways relevant for the synthesis of complex chemical structures. We investigate the Cope rearrangement of 3,4-divinylcyclobut-1-ene using a complete active space self-consistent field (CASSCF) approach and uncover competing pathways near a forbidden electrocyclization.",
    summary:
      "CASSCF study of a Cope rearrangement showing PTSB behavior near a symmetry-forbidden electrocyclization.",
    why_it_matters:
      "Illustrates multichannel reactivity and PTSB near pericyclic manifolds.",
    methods: ["CASSCF", "Potential energy surfaces", "Reaction pathway analysis"],
    keywords: ["Cope rearrangement", "bifurcation", "electrocyclization", "CASSCF"],
    source: "chemrxiv",
    tier: "must_read",
    relevance_score: 94,
    feedback: null,
  },
  {
    id: "7",
    title: "Benchmarking Automated Reaction Path Discovery for Organic Photochemistry",
    authors: ["Demo, A.", "Test, R."],
    journal: "Journal of Computational Chemistry",
    published_date: "2026-02-14",
    doi: "10.1000/demo-photochemistry-2026",
    url: "https://doi.org/10.1000/demo-photochemistry-2026",
    abstract:
      "A benchmark suite compares automated reaction path discovery workflows for excited-state organic reactions, evaluating robustness, runtime, and transition-state recovery across representative photoswitch and pericyclic systems.",
    summary:
      "Compares automated reaction path discovery methods for excited-state organic chemistry across curated benchmark reactions.",
    why_it_matters:
      "Useful for testing screening, saving, and delete workflows while representing realistic computational chemistry content.",
    methods: ["Reaction path discovery", "Benchmarking", "Photochemistry"],
    keywords: ["reaction paths", "photochemistry", "automation", "transition states"],
    source: "crossref",
    tier: "must_read",
    relevance_score: 91,
    feedback: null,
  },
  {
    id: "8",
    title: "Large Language Models as Assistants for Scientific Literature Triage",
    authors: ["Sample, L.", "Atlas, R."],
    journal: "arXiv preprint",
    published_date: "2026-03-02",
    external_id: "2603.00001",
    url: "https://arxiv.org/abs/2603.00001",
    abstract:
      "This study evaluates how language models can support literature triage by ranking paper relevance, generating concise summaries, and explaining uncertainty for interdisciplinary research workflows.",
    summary:
      "Evaluates LLM-assisted paper triage for relevance ranking, summary generation, and uncertainty-aware literature workflows.",
    why_it_matters:
      "A good sample item for testing bulk selection and delete behavior in Daily Digest.",
    methods: ["LLM evaluation", "Literature triage", "Human-in-the-loop review"],
    keywords: ["literature review", "LLM", "triage", "research workflow"],
    source: "arxiv",
    tier: "possibly_relevant",
    relevance_score: 83,
    feedback: null,
  },
];

export const MOCK_STATUS: SystemStatus = {
  backend_ready: true,
  ollama_installed: true,
  ollama_version: "0.3.6",
  ollama_running: true,
  current_llm: "gemma4:e2b",
  chat_llm_model: "gemma4:e2b",
  current_embedding: "nomic-embed-text",
  scan_running: false,
  last_scan: new Date(Date.now() - 3600_000).toISOString(),
  papers_today: 47,
  must_read_today: 4,
  app_data_dir: "~/.research_atlas",
};
