// File: src/services/template_access.ts
// Description: Read access to TEMPLATE projects ("template hearts").
//
// A template project is an ordinary project, owned by the template account,
// with `isTemplate: true`. Every logged-in user may VIEW it on the landmark
// page; only its owner may change it. Viewing goes through
// findViewableProject (used by the read routes the landmark page needs);
// changing is blocked by middleware/template_guard.ts.

import { projectModel, projectSegmentationMaskModel, readProject } from "./database";

// NOTE: mask/reconstruction READ routes (/segmentation/segmentation-results,
// /reconstruction/reconstruction-results) do not check ownership at all, so
// they already serve templates; only the routes below needed changing.

export type ViewableProject = {
    project: any;
    /** The project owner's user id — job/landmark lookups must use this, not the viewer's id. */
    ownerId: string;
    /** True when the viewer owns the project. */
    isOwner: boolean;
    /** True for a template viewed by someone other than its owner. */
    readOnly: boolean;
};

/**
 * The project, if `user` may view it: their own project, or any template.
 * Returns null otherwise (callers answer 404, as for a missing project).
 */
export const findViewableProject = async (projectId: string | undefined, user: any): Promise<ViewableProject | null> => {
    if (!projectId) return null;
    const result = await readProject(projectId);
    const project = result.success ? result.projects?.[0] : undefined;
    if (!project) return null;
    const ownerId = String(project.userid ?? "");
    const isOwner = !!user?._id && ownerId === String(user._id);
    if (!isOwner && !project.isTemplate) return null;
    return { project, ownerId, isOwner, readOnly: !isOwner };
};

/**
 * Template projects for the dashboard's Templates tab, with a few headline
 * numbers from each one's editable segmentation (heart metrics).
 */
export const listTemplateProjects = async () => {
    const projects = await projectModel
        .find({ isTemplate: true })
        .select({ name: 1, description: 1, templateInfo: 1, dimensions: 1, voxelsize: 1, createdAt: 1 })
        .lean();

    const withMetrics = await Promise.all(projects.map(async (p: any) => {
        const mask: any = await projectSegmentationMaskModel
            .findOne({ projectid: String(p._id), isMedSAMOutput: false })
            .select({ heartMetrics: 1 })
            .lean();
        const hm = mask?.heartMetrics ?? {};
        const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);
        return {
            projectId: String(p._id),
            name: p.name,
            description: p.description,
            templateInfo: p.templateInfo ?? null,
            dimensions: p.dimensions,
            metrics: {
                lvef: num(hm.LVEF),
                lvedv: num(hm.LVEDV),
                lvesv: num(hm.LVESV),
                lvMass: num(hm.LV_mass_g),
                rvef: num(hm.RVEF),
            },
        };
    }));

    return withMetrics.sort((a, b) => (a.templateInfo?.order ?? 99) - (b.templateInfo?.order ?? 99));
};
