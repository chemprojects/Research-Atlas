export interface DomainNode {
  id: string;
  label: string;
  children?: DomainNode[];
}

/** Hierarchical research fields for profile domain selection. */
export const RESEARCH_DOMAIN_TREE: DomainNode[] = [
  {
    id: "chemistry",
    label: "Chemistry",
    children: [
      { id: "chem_analytical", label: "Analytical" },
      { id: "chem_organic", label: "Organic" },
      { id: "chem_physical", label: "Physical" },
      { id: "chem_inorganic", label: "Inorganic" },
      { id: "chem_theoretical", label: "Theoretical & Computational" },
      { id: "chem_polymer", label: "Polymer" },
      { id: "chem_medicinal", label: "Medicinal" },
      { id: "chem_environmental", label: "Environmental" },
      { id: "chem_nuclear", label: "Nuclear" },
      { id: "chem_materials", label: "Materials" },
      { id: "chem_supramolecular", label: "Supramolecular" },
      { id: "chem_electrochemistry", label: "Electrochemistry" },
      { id: "chem_photochemistry", label: "Photochemistry" },
    ],
  },
  {
    id: "biology",
    label: "Biology",
    children: [
      { id: "bio_molecular", label: "Molecular" },
      { id: "bio_cell", label: "Cell" },
      { id: "bio_microbiology", label: "Microbiology" },
      { id: "bio_genetics", label: "Genetics & Genomics" },
      { id: "bio_ecology", label: "Ecology" },
      { id: "bio_evolutionary", label: "Evolutionary" },
      { id: "bio_developmental", label: "Developmental" },
      { id: "bio_neuroscience", label: "Neuroscience" },
      { id: "bio_immunology", label: "Immunology" },
      { id: "bio_plant", label: "Plant" },
      { id: "bio_marine", label: "Marine" },
      { id: "bio_structural", label: "Structural" },
      { id: "bio_systems", label: "Systems Biology" },
      { id: "bio_synthetic", label: "Synthetic Biology" },
      { id: "bio_conservation", label: "Conservation" },
    ],
  },
  {
    id: "biochemistry",
    label: "Biochemistry",
    children: [
      { id: "biochem_enzymology", label: "Enzymology" },
      { id: "biochem_protein", label: "Protein Science" },
      { id: "biochem_metabolism", label: "Metabolism" },
      { id: "biochem_membrane", label: "Membrane Biology" },
      { id: "biochem_glycobiology", label: "Glycobiology" },
      { id: "biochem_lipid", label: "Lipid Biochemistry" },
    ],
  },
  {
    id: "physics",
    label: "Physics",
    children: [
      { id: "phys_condensed", label: "Condensed Matter" },
      { id: "phys_particle", label: "Particle & High Energy" },
      { id: "phys_astro", label: "Astrophysics & Cosmology" },
      { id: "phys_optics", label: "Optics & Photonics" },
      { id: "phys_plasma", label: "Plasma" },
      { id: "phys_nuclear", label: "Nuclear" },
      { id: "phys_quantum", label: "Quantum" },
      { id: "phys_biophysics", label: "Biophysics" },
      { id: "phys_atomic", label: "Atomic, Molecular & Optical" },
      { id: "phys_statistical", label: "Statistical & Computational" },
    ],
  },
  {
    id: "engineering",
    label: "Engineering",
    children: [
      { id: "eng_chemical", label: "Chemical" },
      { id: "eng_mechanical", label: "Mechanical" },
      { id: "eng_electrical", label: "Electrical & Electronic" },
      { id: "eng_civil", label: "Civil" },
      { id: "eng_biomedical", label: "Biomedical" },
      { id: "eng_materials", label: "Materials" },
      { id: "eng_environmental", label: "Environmental" },
      { id: "eng_aerospace", label: "Aerospace" },
      { id: "eng_nuclear", label: "Nuclear" },
      { id: "eng_industrial", label: "Industrial & Systems" },
      { id: "eng_petroleum", label: "Petroleum" },
      { id: "eng_robotics", label: "Robotics" },
    ],
  },
  {
    id: "computer_science",
    label: "Computer Science",
    children: [
      { id: "cs_ai", label: "Artificial Intelligence" },
      { id: "cs_ml", label: "Machine Learning" },
      { id: "cs_nlp", label: "Natural Language Processing" },
      { id: "cs_vision", label: "Computer Vision" },
      { id: "cs_systems", label: "Systems & Networks" },
      { id: "cs_theory", label: "Theory" },
      { id: "cs_hci", label: "Human–Computer Interaction" },
      { id: "cs_security", label: "Security & Cryptography" },
      { id: "cs_databases", label: "Databases" },
      { id: "cs_graphics", label: "Graphics & Visualization" },
      { id: "cs_scientific", label: "Scientific Computing" },
    ],
  },
  {
    id: "materials_science",
    label: "Materials Science",
    children: [
      { id: "mat_nanomaterials", label: "Nanomaterials" },
      { id: "mat_polymers", label: "Polymers & Composites" },
      { id: "mat_ceramics", label: "Ceramics" },
      { id: "mat_metals", label: "Metals & Alloys" },
      { id: "mat_semiconductors", label: "Semiconductors" },
      { id: "mat_biomaterials", label: "Biomaterials" },
      { id: "mat_energy", label: "Energy Materials" },
      { id: "mat_characterization", label: "Characterization" },
    ],
  },
  {
    id: "mathematics",
    label: "Mathematics",
    children: [
      { id: "math_applied", label: "Applied" },
      { id: "math_pure", label: "Pure" },
      { id: "math_statistics", label: "Statistics" },
      { id: "math_computational", label: "Computational" },
      { id: "math_optimization", label: "Optimization" },
      { id: "math_dynamical", label: "Dynamical Systems" },
    ],
  },
  {
    id: "earth_environmental",
    label: "Earth & Environmental Sciences",
    children: [
      { id: "earth_geology", label: "Geology" },
      { id: "earth_geophysics", label: "Geophysics" },
      { id: "earth_climate", label: "Climate Science" },
      { id: "earth_oceanography", label: "Oceanography" },
      { id: "earth_atmospheric", label: "Atmospheric Science" },
      { id: "earth_hydrology", label: "Hydrology" },
      { id: "earth_soil", label: "Soil Science" },
      { id: "earth_remote_sensing", label: "Remote Sensing & GIS" },
    ],
  },
  {
    id: "medicine_health",
    label: "Medicine & Health Sciences",
    children: [
      { id: "med_clinical", label: "Clinical Research" },
      { id: "med_pharmacology", label: "Pharmacology" },
      { id: "med_toxicology", label: "Toxicology" },
      { id: "med_epidemiology", label: "Epidemiology" },
      { id: "med_public_health", label: "Public Health" },
      { id: "med_neuroscience", label: "Neuroscience & Neurology" },
      { id: "med_oncology", label: "Oncology" },
      { id: "med_immunology", label: "Immunology" },
      { id: "med_pathology", label: "Pathology" },
    ],
  },
  {
    id: "pharmaceutical",
    label: "Pharmaceutical Sciences",
    children: [
      { id: "pharm_drug_discovery", label: "Drug Discovery" },
      { id: "pharm_formulation", label: "Formulation" },
      { id: "pharm_pharmacokinetics", label: "Pharmacokinetics" },
      { id: "pharm_medicinal_chem", label: "Medicinal Chemistry" },
    ],
  },
  {
    id: "agricultural",
    label: "Agricultural & Food Sciences",
    children: [
      { id: "agri_crop", label: "Crop Science" },
      { id: "agri_soil", label: "Soil & Agronomy" },
      { id: "agri_food", label: "Food Science" },
      { id: "agri_animal", label: "Animal Science" },
      { id: "agri_biotechnology", label: "Agricultural Biotechnology" },
    ],
  },
  {
    id: "interdisciplinary",
    label: "Interdisciplinary",
    children: [
      { id: "inter_chem_bio", label: "Chemical Biology" },
      { id: "inter_bioeng", label: "Bioengineering" },
      { id: "inter_nanotech", label: "Nanotechnology" },
      { id: "inter_data_science", label: "Data Science for Science" },
      { id: "inter_cheminformatics", label: "Cheminformatics" },
      { id: "inter_bioinformatics", label: "Bioinformatics" },
      { id: "inter_comp_chem", label: "Computational Chemistry" },
      { id: "inter_comp_bio", label: "Computational Biology" },
      { id: "inter_sustainability", label: "Sustainability Science" },
      { id: "inter_energy", label: "Energy Science" },
      { id: "inter_catalysis", label: "Catalysis" },
      { id: "inter_protein_eng", label: "Protein Engineering" },
    ],
  },
];

export function formatDomainPath(parentLabel: string, childLabel: string): string {
  return `${parentLabel} › ${childLabel}`;
}

export function allDomainPaths(): string[] {
  const paths: string[] = [];
  for (const parent of RESEARCH_DOMAIN_TREE) {
    if (parent.children) {
      for (const child of parent.children) {
        paths.push(formatDomainPath(parent.label, child.label));
      }
    } else {
      paths.push(parent.label);
    }
  }
  return paths;
}
