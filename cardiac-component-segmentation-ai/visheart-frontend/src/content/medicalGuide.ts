export type Reference = {
  citation: string;
} & (
  | {
      doi: string;
      url?: never;
    }
  | {
      url: string;
      doi?: never;
    }
);

export const REFERENCES = {
  nhlbi: {
    citation: "National Heart, Lung, and Blood Institute. How the Heart Works: What the Heart Looks Like.",
    url: "https://www.nhlbi.nih.gov/health/heart/anatomy",
  },
  cdc: {
    citation: "Centers for Disease Control and Prevention. How the Heart Works.",
    url: "https://www.cdc.gov/heart-defects/how-the-heart-works/index.html",
  },
  kubler2021: {
    citation:
      "Kübler J, Burgstahler C, Brendel JM, et al. Cardiac MRI findings to differentiate athlete's heart from hypertrophic (HCM), arrhythmogenic right ventricular (ARVC) and dilated (DCM) cardiomyopathy. Int J Cardiovasc Imaging. 2021;37(8):2501–2515.",
    doi: "10.1007/s10554-021-02280-6",
  },
  escers2022: {
    citation:
      "Humbert M, Kovacs G, Hoeper MM, et al. 2022 ESC/ERS Guidelines for the diagnosis and treatment of pulmonary hypertension. Eur Respir J. 2023;61(1):2200879.",
    doi: "10.1183/13993003.00879-2022",
  },
  scmr2025: {
    citation:
      'Kawel-Boehm N, Hetzel SJ, Ambale-Venkatesh B, et al. Society for Cardiovascular Magnetic Resonance reference values ("normal values") in cardiovascular magnetic resonance: 2025 update. J Cardiovasc Magn Reson. 2025;27:101853.',
    doi: "10.1016/j.jocmr.2025.101853",
  },
  teriele2014: {
    citation:
      "te Riele ASJM, Tandri H, Bluemke DA. Arrhythmogenic right ventricular cardiomyopathy (ARVC): cardiovascular magnetic resonance update. J Cardiovasc Magn Reson. 2014;16:50.",
    doi: "10.1186/s12968-014-0050-8",
  },
  zhan2024: {
    citation:
      "Zhan Y, Friedrich MG, Dendukuri N, Lu Y, Chetrit M, Schiller I, Joseph L, Shaw JL, Chuang ML, Riffel JH, Manning WJ, Afilalo J. Meta-Analysis of Normal Reference Values for Right and Left Ventricular Quantification by Cardiovascular Magnetic Resonance. Circ Cardiovasc Imaging. 2024;17(2):e016090.",
    doi: "10.1161/CIRCIMAGING.123.016090",
  },
  bazhutina2023: {
    citation:
      "Bazhutina A, Khamzin S, Chmelevsky M, Zubarev S, Sinitca A, Budanova M, Rainer W. An automated algorithm for generating of AHA model based on 3D heart geometry. Computing in Cardiology (CinC). 2023.",
    doi: "10.22489/CinC.2023.257",
  },
  tokodi2021: {
    citation:
      "Tokodi M, Staub L, Budai Á, et al. Partitioning the Right Ventricle Into 15 Segments and Decomposing Its Motion Using 3D Echocardiography-Based Models: The Updated ReVISION Method. Front Cardiovasc Med. 2021;8:622118.",
    doi: "10.3389/fcvm.2021.622118",
  },
} as const satisfies Record<string, Reference>;

export type RefId = keyof typeof REFERENCES;


export interface Claim {
  text: string;
  refs: RefId[];
}

export type CalloutVariant = "info" | "caution" | "disclaimer";

export interface CalloutBlock {
  kind: "callout";
  variant: CalloutVariant;
  title: string;
  body: Claim[];
}

export interface RangeRow {
  parameter: string;
  men: string;
  women: string;
  unit: string;
  refs: RefId[];
}

export interface RangeGroup {
  label: string;
  rows: RangeRow[];
}

export interface RangeTableBlock {
  kind: "rangeTable";
  caption: string;
  groups: RangeGroup[];
  footnotes?: Claim[];
}

export interface FigureBlock {
  kind: "figure";
  src?: string;
  alt: string;
  caption: string;
  attribution: string;
  refs?: RefId[];
}

export interface Condition {
  id: string;
  name: string;
  badge?: string;
  summary: Claim;
  imagingFeatures: Claim[];
}

export interface ConditionsBlock {
  kind: "conditions";
  conditions: Condition[];
  note?: Claim;
}

export type ContentBlock = CalloutBlock | RangeTableBlock | FigureBlock | ConditionsBlock;

export interface GuideSection {
  id: string;
  title: string;
  summary: Claim[];
  detail?: Claim[];
  blocks?: ContentBlock[];
  subsections?: GuideSection[];
}

export interface MedicalGuide {
  title: string;
  description: string;
  disclaimer: CalloutBlock;
  sections: GuideSection[];
  referencesSectionId: string;
}

export const MEDICAL_GUIDE: MedicalGuide = {
  title: "Medical Guide",
  description:
    "Educational information about the heart, cardiac MRI, and the measurements VisHeart reports, based on published medical research.",

  disclaimer: {
    kind: "callout",
    variant: "disclaimer",
    title: "For education only",
    body: [
      {
        text: "This guide explains general heart and cardiac MRI concepts to help you understand VisHeart's results. It is not medical advice.",
        refs: [],
      },
      {
        text: "VisHeart's outputs are not a diagnosis. Results should always be reviewed by a qualified clinician.",
        refs: [],
      },
    ],
  },

  sections: [
    {
      id: "how-the-heart-works",
      title: "How the heart works",
      summary: [
        {
          text: "Your heart is a muscular pump in your chest. It has four chambers, with valves between them that keep blood flowing in one direction. The right side sends blood to the lungs to pick up oxygen, and the left side pumps that oxygen-rich blood to the rest of the body.",
          refs: ["nhlbi", "cdc"],
        },
      ],
      blocks: [
        {
          kind: "figure",
          alt: "Diagram of the heart showing the four chambers and the direction of blood flow",
          caption: "The four chambers of the heart and the direction of blood flow.",
          attribution: "[PLACEHOLDER: figure source and licence]",
        },
      ],
      subsections: [
        {
          id: "heart-chambers",
          title: "The four chambers",
          summary: [
            {
              text: "The two upper chambers are the atria, and the two lower chambers are the ventricles. Blood returning from the body and lungs enters the atria, then passes into the ventricles, which pump it out of the heart. A wall of tissue called the septum separates the left and right sides.",
              refs: ["nhlbi"],
            },
          ],
          detail: [
            {
              text: "Oxygen-poor blood returns from the body through the superior and inferior vena cava into the right atrium, passes through the tricuspid valve into the right ventricle, and is pumped through the pulmonary valve into the pulmonary artery and on to the lungs.",
              refs: ["cdc"],
            },
            {
              text: "Oxygen-rich blood returns from the lungs through the pulmonary veins into the left atrium, passes through the mitral valve into the left ventricle, and is pumped out to the body through the aorta.",
              refs: ["cdc"],
            },
            {
              text: "The heart wall has three layers: the endocardium (inner lining), the myocardium (the thick muscle layer that contracts), and the pericardium (the protective sac around the heart). VisHeart's segmentation outlines the myocardium.",
              refs: ["nhlbi"],
            },
          ],
        },
        {
          id: "lv-vs-rv",
          title: "Left vs right ventricle",
          summary: [
            {
              text: "The left ventricle has a thick muscular wall, while the right ventricle's wall is much thinner. The right ventricle pumps blood into the arteries of the lungs, so conditions that raise the pressure there put it under strain.",
              refs: ["kubler2021", "escers2022"],
            },
          ],
          detail: [
            {
              text: "In one cardiac MRI study, right ventricular wall thickness averaged 2.0–3.7 mm across groups, compared with 8.8–12.4 mm for the septum.",
              refs: ["kubler2021"],
            },
            {
              text: "Normal right ventricular volumes are slightly larger than left ventricular volumes; for example, the upper limit of normal end-diastolic volume in men is 231 mL for the right ventricle and 204 mL for the left.",
              refs: ["scmr2025"],
            },
            {
              text: "The right ventricle's complex shape makes it hard to assess with echocardiography or angiography; cardiac MRI is considered the non-invasive reference standard for evaluating it.",
              refs: ["teriele2014"],
            },
            {
              text: "The right ventricle pumps in three main ways: it shortens from base to apex as the tricuspid valve ring is pulled towards the apex, its free wall moves inwards (the 'bellows effect'), and it is squeezed front to back when the septum bulges into it as the left ventricle contracts.",
              refs: ["tokodi2021"],
            },
          ],
        },
        {
          id: "cardiac-cycle",
          title: "The cardiac cycle: end-diastole and end-systole",
          summary: [
            {
              text: "Each heartbeat has two phases. During diastole the heart muscle relaxes and the ventricles fill with blood. During systole the muscle contracts and pumps blood out. End-diastole is the moment the ventricles are fullest, and end-systole is the moment they are emptiest. VisHeart measures the heart at both of these points.",
              refs: ["nhlbi", "scmr2025"],
            },
          ],
          detail: [
            {
              text: "End-diastolic volume (EDV) is the ventricular volume at end-diastole, and end-systolic volume (ESV) is the volume at end-systole. Cardiac MRI reference values are published for both.",
              refs: ["scmr2025"],
            },
            {
              text: "Cine MRI images are ECG-triggered, so each frame corresponds to a phase of the heartbeat.",
              refs: ["kubler2021"],
            },
          ],
        },
      ],
    },
    {
      id: "cardiac-mri",
      title: "How cardiac MRI images the heart",
      summary: [
        {
          text: "Cardiac magnetic resonance imaging (cardiac MRI) produces detailed moving images of the beating heart. A single scan can measure the size and pumping function of each chamber and show changes in the heart muscle itself.",
          refs: ["escers2022", "teriele2014"],
        },
      ],
      detail: [
        {
          text: "Function is usually assessed with cine steady-state free precession (SSFP) images acquired with ECG triggering during breath-holds, including a stack of short-axis slices covering both ventricles from base to apex.",
          refs: ["kubler2021"],
        },
        {
          text: "Ventricular volumes are measured on the short-axis stack, which typically needs about 10–12 slices to cover the whole ventricle.",
          refs: ["teriele2014"],
        },
        {
          text: "Late gadolinium enhancement (LGE) images, taken about 10 minutes after a gadolinium contrast injection, highlight areas of myocardial damage such as fibrosis. LGE is valuable but not specific to one disease.",
          refs: ["kubler2021", "teriele2014"],
        },
        {
          text: "Normal values depend on the imaging sequence and analysis method, for example whether papillary muscles are counted as part of the blood volume or the heart muscle. Results should be compared with reference ranges measured the same way.",
          refs: ["scmr2025"],
        },
      ],
      blocks: [
        {
          kind: "figure",
          alt: "Cardiac MRI views of the heart: four-chamber and short-axis, at end-diastole and end-systole",
          caption: "Standard cine MRI views used to measure the heart.",
          attribution: "[PLACEHOLDER: figure source and licence]",
        },
      ],
    },
    {
      id: "measurements",
      title: "Understanding VisHeart's measurements",
      summary: [
        {
          text: "VisHeart outlines the heart on each MRI slice and uses those outlines to calculate how large the ventricles are and how well they pump. The sections below explain each measurement in plain terms.",
          refs: [],
        },
      ],
      subsections: [
        {
          id: "ejection-fraction",
          title: "Ejection fraction (EF)",
          summary: [
            {
              text: "Ejection fraction is the percentage of blood a ventricle pumps out with each heartbeat. In healthy adults, the left ventricle usually pumps out a little over half to about three-quarters of the blood it holds.",
              refs: ["scmr2025"],
            },
          ],
          detail: [
            { text: "EF (%) = (EDV − ESV) ÷ EDV × 100.", refs: ["scmr2025"] },
            { text: "Normal left ventricular EF: men 51–77%, women 54–79%.", refs: ["scmr2025"] },
            { text: "Normal right ventricular EF: men 44–72%, women 47–75%.", refs: ["scmr2025"] },
            {
              text: "A 2024 meta-analysis of healthy adults reported normal left ventricular EF of 52–73% in men and 54–75% in women (papillary muscles counted as blood volume), and normal right ventricular EF of 47–68% in men and 49–71% in women.",
              refs: ["zhan2024"],
            },
            {
              text: "Normal ranges vary by ethnicity. For example, in Chinese adults normal left ventricular EF is 53–78% in men and 57–81% in women (measured with papillary muscles counted as heart muscle).",
              refs: ["scmr2025"],
            },
            {
              text: "Highly trained athletes can have a low-normal EF at rest; in one study of top-level athletes, right ventricular EF was below the normal range in 40%.",
              refs: ["kubler2021"],
            },
          ],
        },
        {
          id: "edv-esv",
          title: "End-diastolic and end-systolic volume (EDV, ESV)",
          summary: [
            {
              text: "End-diastolic volume (EDV) is how much blood a ventricle holds when it is fullest. End-systolic volume (ESV) is how much is left after it contracts. Normal heart size varies with body size, sex and age, so these are always compared with ranges for similar people.",
              refs: ["scmr2025"],
            },
          ],
          detail: [
            {
              text: "Normal left ventricular EDV: men 81–204 mL, women 68–158 mL. Normal left ventricular ESV: men 17–88 mL, women 14–63 mL.",
              refs: ["scmr2025"],
            },
            {
              text: "Because heart size scales with body size, volumes are often divided by body surface area (BSA). Normal left ventricular EDV/BSA: men 49–102 mL/m², women 46–90 mL/m².",
              refs: ["scmr2025"],
            },
            {
              text: "The same 2024 meta-analysis reported normal left ventricular EDV/BSA of 60–109 mL/m² in men and 56–96 mL/m² in women. These differ slightly from the SCMR ranges, which shows how reference values depend on the study population and method.",
              refs: ["zhan2024"],
            },
            {
              text: "A large ventricle is not always a sign of disease. In one study, 58% of top-level athletes had an enlarged left ventricular EDV index (mean 105 mL/m²).",
              refs: ["kubler2021"],
            },
          ],
        },
        {
          id: "stroke-volume",
          title: "Stroke volume (SV)",
          summary: [
            {
              text: "Stroke volume is the amount of blood a ventricle pumps out with each heartbeat. It is the difference between EDV and ESV.",
              refs: ["scmr2025"],
            },
          ],
          detail: [
            { text: "SV = EDV − ESV.", refs: ["scmr2025"] },
            {
              text: "Normal left ventricular SV: men 53–128 mL, women 45–103 mL. Normal right ventricular SV: men 33–146 mL, women 32–109 mL.",
              refs: ["scmr2025"],
            },
            {
              text: "When a ventricle is large and EF is borderline, a normal indexed stroke volume can help point towards a healthy athlete's heart rather than a cardiomyopathy.",
              refs: ["kubler2021"],
            },
          ],
        },
        {
          id: "strain",
          title: "Strain",
          summary: [
            {
              text: "Strain describes how much the heart muscle deforms as it contracts, for example how much it shortens or thickens compared with its relaxed state. It is reported as a percentage, and shortening is shown as a negative number, so a more negative value means more shortening.",
              refs: ["scmr2025"],
            },
          ],
          detail: [
            {
              text: "Circumferential strain (shortening around the ventricle) and radial strain (wall thickening) are measured on short-axis images. Longitudinal strain (base-to-apex shortening) is usually averaged over two-, three- and four-chamber long-axis views.",
              refs: ["scmr2025"],
            },
            { text: "Strain is measured with tagged MRI or with feature tracking on standard cine images.", refs: ["scmr2025"] },
            {
              text: "Normal values depend strongly on the software used. For example, reported normal left ventricular global circumferential strain in men averages between −16.5% and −23.7% depending on the method.",
              refs: ["scmr2025"],
            },
            { text: "In most studies, women have higher strain values than men, and strain decreases with age.", refs: ["scmr2025"] },
            { text: "The SCMR 2025 reference values do not include normal ranges for radial strain.", refs: ["scmr2025"] },
            {
              text: "Right ventricular strain can be measured in the longitudinal and circumferential directions, and as area strain: the change in the ventricle's inner surface area between end-diastole and end-systole.",
              refs: ["tokodi2021"],
            },
            {
              text: "When the right ventricle works against high pressure, such as in pulmonary hypertension, the inward movement of its free wall can be affected early, so it may show right ventricular dysfunction before global measures change.",
              refs: ["tokodi2021"],
            },
          ],
          blocks: [
            {
              kind: "callout",
              variant: "info",
              title: "About VisHeart's strain values",
              body: [
                {
                  text: "VisHeart estimates radial and circumferential strain from changes in the radius of the heart wall across the heartbeat on short-axis images, and reports the peak values. This differs from the tagging and feature-tracking methods used in published studies, so VisHeart's strain values should not be compared directly with published normal ranges. For the right ventricle, VisHeart's strain approach draws on the ReVISION method.",
                  refs: ["scmr2025", "tokodi2021"],
                },
              ],
            },
          ],
        },
        {
          id: "normal-ranges",
          title: "Normal ranges at a glance",
          summary: [],
          blocks: [
            {
              kind: "callout",
              variant: "caution",
              title: "Use these ranges as a guide only",
              body: [
                {
                  text: "Published ranges come from specific imaging and analysis methods, which may differ from VisHeart's. They describe healthy adults in general and cannot be used to diagnose an individual.",
                  refs: ["scmr2025"],
                },
              ],
            },
            {
              kind: "rangeTable",
              caption: "Normal ranges for healthy adults on cardiac MRI (bSSFP), shown as lower–upper limits.",
              groups: [
                {
                  label: "Left ventricle",
                  rows: [
                    { parameter: "Ejection fraction (EF)", men: "51–77", women: "54–79", unit: "%", refs: ["scmr2025"] },
                    { parameter: "End-diastolic volume (EDV)", men: "81–204", women: "68–158", unit: "mL", refs: ["scmr2025"] },
                    { parameter: "End-systolic volume (ESV)", men: "17–88", women: "14–63", unit: "mL", refs: ["scmr2025"] },
                    { parameter: "Stroke volume (SV)", men: "53–128", women: "45–103", unit: "mL", refs: ["scmr2025"] },
                  ],
                },
                {
                  label: "Right ventricle",
                  rows: [
                    { parameter: "Ejection fraction (EF)", men: "44–72", women: "47–75", unit: "%", refs: ["scmr2025"] },
                    { parameter: "End-diastolic volume (EDV)", men: "74–231", women: "59–172", unit: "mL", refs: ["scmr2025"] },
                    { parameter: "End-systolic volume (ESV)", men: "26–104", women: "17–75", unit: "mL", refs: ["scmr2025"] },
                    { parameter: "Stroke volume (SV)", men: "33–146", women: "32–109", unit: "mL", refs: ["scmr2025"] },
                  ],
                },
              ],
              footnotes: [
                {
                  text: "Papillary muscles and trabeculations are counted as part of the blood volume (SCMR 2025, Tables 3 and 9), which matches how VisHeart's segmentation measures the ventricles. Ranges also vary with age and ethnicity.",
                  refs: ["scmr2025"],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "aha-17-segment",
      title: "The AHA 17-segment model",
      summary: [
        {
          text: "To describe where a problem is in the heart muscle, the left ventricle is divided into 17 standard segments defined by the American Heart Association. The model is widely used in clinical practice, for example to describe wall motion or locate damage from a heart attack.",
          refs: ["bazhutina2023"],
        },
      ],
      detail: [
        {
          text: "The left ventricle is divided along its long axis into basal, mid and apical levels: segments 1–6 are basal, 7–12 are mid, 13–16 are apical, and segment 17 is the apex.",
          refs: ["bazhutina2023"],
        },
        {
          text: "Basal and mid segments each cover 60° around the ventricle; apical segments each cover 90°.",
          refs: ["bazhutina2023"],
        },
        {
          text: "The segments are usually displayed as a flat 'bull's-eye' plot.",
          refs: ["bazhutina2023"],
        },
        {
          text: "Drawing the 17 segments by hand takes a lot of time, which is why automated methods are being developed. In one automated method, segment boundaries were less accurate near the apex than at the base.",
          refs: ["bazhutina2023"],
        },
        {
          text: "Unlike the left ventricle, the right ventricle has no generally accepted standard segmentation because of its complex shape. Research methods divide it in different ways; for example, the ReVISION method, developed for 3D echocardiography, uses 15 segments.",
          refs: ["tokodi2021"],
        },
        { text: "VisHeart uses this model to label segments on the 3D reconstruction of the left ventricle.", refs: [] },
      ],
      blocks: [
        {
          kind: "figure",
          alt: "Bull's-eye plot of the 17 left ventricular segments, numbered 1 to 17",
          caption: "The AHA 17-segment model shown as a bull's-eye plot.",
          attribution: "[PLACEHOLDER: figure source and licence]",
          refs: ["bazhutina2023"],
        },
      ],
    },
    {
      id: "heart-conditions",
      title: "Heart conditions",
      summary: [
        {
          text: "Several heart muscle diseases (cardiomyopathies) change the size, wall thickness or pumping of the ventricles in ways cardiac MRI can measure. Some of these changes also appear in healthy, highly trained athletes, so no single measurement is enough for a diagnosis.",
          refs: ["kubler2021"],
        },
      ],
      blocks: [
        {
          kind: "callout",
          variant: "info",
          title: "How this relates to VisHeart",
          body: [
            {
              text: "VisHeart's Disease Similarity feature compares a scan's measurements with patterns typical of a normal heart, HCM and DCM. It shows how similar the patterns are. It does not diagnose disease.",
              refs: [],
            },
          ],
        },
        {
          kind: "conditions",
          conditions: [
            {
              id: "hcm",
              name: "Hypertrophic cardiomyopathy (HCM)",
              badge: "Compared in VisHeart",
              summary: {
                text: "A disease in which the heart muscle becomes abnormally thick, especially the septum between the ventricles.",
                refs: ["kubler2021"],
              },
              imagingFeatures: [
                { text: "Thicker septum: mean 12.4 mm in HCM patients vs 9.7 mm in athletes.", refs: ["kubler2021"] },
                {
                  text: "A left ventricular wall over 12–15 mm favours HCM; a septum up to 15 mm occurs in up to 2% of highly trained athletes.",
                  refs: ["kubler2021"],
                },
                {
                  text: "LGE (scarring) in 57% of patients, mainly in the outer and middle layers of the wall.",
                  refs: ["kubler2021"],
                },
                { text: "Pumping function is often preserved (mean left ventricular EF 59%).", refs: ["kubler2021"] },
              ],
            },
            {
              id: "dcm",
              name: "Dilated cardiomyopathy (DCM)",
              badge: "Compared in VisHeart",
              summary: {
                text: "A disease in which the left ventricle becomes enlarged and pumps weakly.",
                refs: ["kubler2021"],
              },
              imagingFeatures: [
                {
                  text: "Low ejection fraction: mean left ventricular EF 29%, below normal in 96% of patients.",
                  refs: ["kubler2021"],
                },
                {
                  text: "Enlarged left ventricle: mean end-diastolic diameter 67 mm vs 53 mm in athletes.",
                  refs: ["kubler2021"],
                },
                {
                  text: "Left ventricle much larger than the right: LVEDV/RVEDV ratio 1.5 vs 0.89 in athletes.",
                  refs: ["kubler2021"],
                },
                { text: "LGE in 44% of patients, often in a linear or patchy pattern.", refs: ["kubler2021"] },
              ],
            },
            {
              id: "arvc",
              name: "Arrhythmogenic right ventricular cardiomyopathy (ARVC)",
              summary: {
                text: "An inherited disease in which heart muscle, mainly in the right ventricle, is gradually replaced by fibrous and fatty tissue, which can cause dangerous heart rhythms.",
                refs: ["teriele2014"],
              },
              imagingFeatures: [
                {
                  text: "MRI major criterion: abnormal regional right ventricular wall motion PLUS either an enlarged right ventricle (EDV/BSA ≥110 mL/m² in men, ≥100 mL/m² in women) or right ventricular EF ≤40%.",
                  refs: ["teriele2014"],
                },
                {
                  text: "In one study, 61% of ARVC patients had right ventricular wall-motion abnormalities (mean right ventricular EF 46%).",
                  refs: ["kubler2021"],
                },
                { text: "The left ventricle can also be affected.", refs: ["teriele2014"] },
                {
                  text: "MRI alone cannot diagnose ARVC; diagnosis combines several tests, including ECG, rhythm monitoring and family history.",
                  refs: ["teriele2014"],
                },
              ],
            },
            {
              id: "athletes-heart",
              name: "Athlete's heart",
              badge: "Normal adaptation",
              summary: {
                text: "A normal adaptation to intense, long-term training, in which the heart becomes larger and slightly thicker.",
                refs: ["kubler2021"],
              },
              imagingFeatures: [
                { text: "Both ventricles enlarge in a balanced way.", refs: ["kubler2021"] },
                {
                  text: "Ejection fraction can be low-normal at rest, but stroke volume stays normal.",
                  refs: ["kubler2021"],
                },
                {
                  text: "No wall-motion abnormalities, and LGE is rare (1 of 40 athletes in one study).",
                  refs: ["kubler2021"],
                },
                { text: "The septum can be slightly thicker than average.", refs: ["kubler2021"] },
              ],
            },
            {
              id: "pulmonary-hypertension",
              name: "Pulmonary hypertension / RV dysfunction",
              summary: {
                text: "Raised blood pressure in the arteries of the lungs. It puts extra strain on the right ventricle, and how well the right ventricle copes is a key factor in the outlook.",
                refs: ["escers2022"],
              },
              imagingFeatures: [
                {
                  text: "Diagnosed by right heart catheterisation, not MRI: mean pulmonary arterial pressure >20 mmHg at rest. Pulmonary arterial hypertension also requires pulmonary vascular resistance >2 Wood units and pulmonary arterial wedge pressure ≤15 mmHg.",
                  refs: ["escers2022"],
                },
                {
                  text: "Right ventricular volumes, EF and stroke volume are key predictors of outcome.",
                  refs: ["escers2022"],
                },
                {
                  text: "MRI risk bands (low / intermediate / high): right ventricular EF >54% / 37–54% / <37%; stroke volume index >40 / 26–40 / <26 mL/m²; right ventricular ESV index <42 / 42–54 / >54 mL/m².",
                  refs: ["escers2022"],
                },              ],
            },
          ],
          note: {
            text: "Figures in these cards are averages from research studies, not diagnostic cut-offs.",
            refs: [],
          },
        },
      ],
    },
  ],

  referencesSectionId: "references",
};

const claimRefs = (claims: Claim[] = []): RefId[] => claims.flatMap((claim) => claim.refs);

function blockRefs(block: ContentBlock): RefId[] {
  switch (block.kind) {
    case "callout":
      return claimRefs(block.body);
    case "rangeTable":
      return [...block.groups.flatMap((group) => group.rows.flatMap((row) => row.refs)), ...claimRefs(block.footnotes)];
    case "figure":
      return block.refs ?? [];
    case "conditions":
      return [
        ...block.conditions.flatMap((condition) => [...condition.summary.refs, ...claimRefs(condition.imagingFeatures)]),
        ...(block.note?.refs ?? []),
      ];
  }
}

function sectionRefs(section: GuideSection): RefId[] {
  return [
    ...claimRefs(section.summary),
    ...claimRefs(section.detail),
    ...(section.blocks ?? []).flatMap(blockRefs),
    ...(section.subsections ?? []).flatMap(sectionRefs),
  ];
}

export const CITED_REFERENCE_IDS: RefId[] = [
  ...new Set([...claimRefs(MEDICAL_GUIDE.disclaimer.body), ...MEDICAL_GUIDE.sections.flatMap(sectionRefs)]),
];

export function referenceNumber(id: RefId): number {
  return CITED_REFERENCE_IDS.indexOf(id) + 1;
}
