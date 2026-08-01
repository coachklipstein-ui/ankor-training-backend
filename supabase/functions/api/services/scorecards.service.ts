import { sbAdmin } from "./supabase.ts";

export type ScorecardTemplateRow = {
  id: string;
  org_id: string | null;
  sport_id: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ScorecardCategory = {
  id: string;
  template_id: string;
  name: string;
  description: string | null;
  position: number;
  created_at: string;
};

export type ScorecardCategoryInput = {
  name: string;
  description: string | null;
  position?: number;
  subskills: ScorecardSubskillInput[];
};

export type ScorecardSubskillInput = {
  name: string;
  description: string | null;
  position?: number;
  skill_id: string;
  rating_min?: number;
  rating_max?: number;
  priority?: number;
};

export type ScorecardSubskillAddInput = ScorecardSubskillInput & {
  category_id: string;
};

export async function rpcCreateScorecardTemplate(payload: { p_template: unknown; p_created_by?: string }) {
  return await sbAdmin!.rpc("create_scorecard_template_tx", payload);
}

export async function listScorecardTemplates(params: {
  org_id: string; // required
  sport_id?: string | null; // optional
  q?: string; // optional (search name/description)
  limit?: number; // default 10, max 200
  offset?: number; // default 0
}) {
  const limit = Number.isFinite(params.limit as number) ? Math.min(Math.max(Number(params.limit), 1), 200) : 10;

  const offset = Number.isFinite(params.offset as number) ? Math.max(Number(params.offset), 0) : 0;

  let query = sbAdmin!
    .from("scorecard_templates")
    .select("id, org_id, sport_id, name, description, is_active, created_by, created_at, updated_at", {
      count: "exact",
    })
    .eq("org_id", params.org_id)
    .order("updated_at", { ascending: false })
    .range(offset, offset + (limit - 1));

  if (params.sport_id) query = query.eq("sport_id", params.sport_id);
  if (params.q?.trim()) {
    const q = params.q.trim();
    // Case-insensitive search on name OR description
    query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`);
  }

  return await query; // { data, count, error }
}

export async function getScorecardTemplateById(args: { org_id: string; template_id: string }) {
  const { org_id, template_id } = args;

  const { data, error } = await sbAdmin!
    .from("scorecard_templates")
    .select(
      `
      id,
      org_id,
      sport_id,
      name,
      description,
      is_active,
      created_by,
      created_at,
      updated_at,
      scorecard_categories (
        id,
        template_id,
        name,
        description,
        position,
        created_at,
        scorecard_subskills (
          id,
          category_id,
          skill_id,
          name,
          description,
          position,
          rating_min,
          rating_max,
          created_at
        )
      )
    `,
    )
    .eq("id", template_id)
    .eq("org_id", org_id)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }

  if (!data) {
    return { data: null, error: null };
  }

  const categories = Array.isArray((data as any).scorecard_categories) ? (data as any).scorecard_categories : [];
  categories.sort((a: any, b: any) => (a?.position ?? 0) - (b?.position ?? 0));

  for (const category of categories) {
    const subskills = Array.isArray(category?.scorecard_subskills) ? category.scorecard_subskills : [];
    subskills.sort((a: any, b: any) => (a?.position ?? 0) - (b?.position ?? 0));
    category.scorecard_subskills = subskills;
  }

  (data as any).scorecard_categories = categories;

  return { data, error: null };
}

export async function updateScorecardTemplate(args: {
  org_id: string;
  template_id: string;
  add_categories: ScorecardCategoryInput[];
  remove_category_ids: string[];
  add_subskills: ScorecardSubskillAddInput[];
  remove_subskill_ids: string[];
}) {
  const { org_id, template_id, add_categories, remove_category_ids, add_subskills, remove_subskill_ids } = args;

  const { data: template, error: templateError } = await sbAdmin!
    .from("scorecard_templates")
    .select("id")
    .eq("id", template_id)
    .eq("org_id", org_id)
    .maybeSingle();

  if (templateError) {
    return { data: null, error: templateError, notFound: false };
  }

  if (!template) {
    return { data: null, error: null, notFound: true };
  }

  const { data: categories, error: categoriesError } = await sbAdmin!
    .from("scorecard_categories")
    .select("id, position")
    .eq("template_id", template_id);

  if (categoriesError) {
    return { data: null, error: categoriesError, notFound: false };
  }

  const existingCategoryIds = new Set((categories ?? []).map((category) => category.id));
  const maxCategoryPosition = (categories ?? []).reduce(
    (max, category) => Math.max(max, Number.isFinite(category.position) ? category.position : 0),
    0,
  );

  for (const categoryId of remove_category_ids) {
    if (!existingCategoryIds.has(categoryId)) {
      return {
        data: null,
        error: new Error("One or more category ids do not belong to this template."),
        notFound: false,
      };
    }
  }

  for (const subskill of add_subskills) {
    if (!existingCategoryIds.has(subskill.category_id)) {
      return {
        data: null,
        error: new Error("One or more subskills refer to an invalid category."),
        notFound: false,
      };
    }
  }

  for (const categoryId of remove_category_ids) {
    for (const subskill of add_subskills) {
      if (subskill.category_id === categoryId) {
        return {
          data: null,
          error: new Error("Cannot add subskills to a category being removed."),
          notFound: false,
        };
      }
    }
  }

  if (remove_subskill_ids.length > 0) {
    const { data: subskills, error: subskillsError } = await sbAdmin!
      .from("scorecard_subskills")
      .select("id, category_id")
      .in("id", remove_subskill_ids);

    if (subskillsError) {
      return { data: null, error: subskillsError, notFound: false };
    }

    const subskillsData = subskills ?? [];
    if (subskillsData.length !== remove_subskill_ids.length) {
      return {
        data: null,
        error: new Error("One or more subskill ids are invalid."),
        notFound: false,
      };
    }

    for (const subskill of subskillsData) {
      if (!existingCategoryIds.has(subskill.category_id)) {
        return {
          data: null,
          error: new Error("One or more subskills do not belong to this template."),
          notFound: false,
        };
      }
    }

    const { error: deleteSubskillError } = await sbAdmin!
      .from("scorecard_subskills")
      .delete()
      .in("id", remove_subskill_ids);

    if (deleteSubskillError) {
      return { data: null, error: deleteSubskillError, notFound: false };
    }
  }

  if (remove_category_ids.length > 0) {
    const { error: deleteCategoryError } = await sbAdmin!
      .from("scorecard_categories")
      .delete()
      .eq("template_id", template_id)
      .in("id", remove_category_ids);

    if (deleteCategoryError) {
      return { data: null, error: deleteCategoryError, notFound: false };
    }
  }

  const addedCategoryIds: string[] = [];
  const addedSubskillIds: string[] = [];

  let categoryPositionCursor = maxCategoryPosition;

  for (const category of add_categories) {
    const position = Number.isFinite(category.position) ? (category.position as number) : (categoryPositionCursor += 1);

    const { data: insertedCategories, error: insertCategoryError } = await sbAdmin!
      .from("scorecard_categories")
      .insert({
        template_id,
        name: category.name,
        description: category.description,
        position,
      })
      .select("id")
      .limit(1);

    if (insertCategoryError) {
      return { data: null, error: insertCategoryError, notFound: false };
    }

    const insertedCategoryId = insertedCategories?.[0]?.id;
    if (!insertedCategoryId) {
      return {
        data: null,
        error: new Error("Failed to create scorecard category."),
        notFound: false,
      };
    }

    addedCategoryIds.push(insertedCategoryId);

    let subskillPositionCursor = 0;
    const subskillRows = category.subskills.map((subskill) => {
      const row: Record<string, unknown> = {
        category_id: insertedCategoryId,
        name: subskill.name,
        description: subskill.description,
        position: Number.isFinite(subskill.position) ? subskill.position : (subskillPositionCursor += 1),
        skill_id: subskill.skill_id,
      };

      if (Number.isFinite(subskill.rating_min)) {
        row.rating_min = subskill.rating_min;
      }
      if (Number.isFinite(subskill.rating_max)) {
        row.rating_max = subskill.rating_max;
      }
      if (Number.isFinite(subskill.priority)) {
        row.priority = subskill.priority;
      }

      return row;
    });

    const { data: insertedSubskills, error: insertSubskillsError } = await sbAdmin!
      .from("scorecard_subskills")
      .insert(subskillRows)
      .select("id");

    if (insertSubskillsError) {
      return { data: null, error: insertSubskillsError, notFound: false };
    }

    for (const subskill of insertedSubskills ?? []) {
      if (subskill?.id) {
        addedSubskillIds.push(subskill.id);
      }
    }
  }

  if (add_subskills.length > 0) {
    const categoryIds = Array.from(new Set(add_subskills.map((subskill) => subskill.category_id)));

    const { data: existingSubskills, error: existingSubskillsError } = await sbAdmin!
      .from("scorecard_subskills")
      .select("category_id, position")
      .in("category_id", categoryIds);

    if (existingSubskillsError) {
      return { data: null, error: existingSubskillsError, notFound: false };
    }

    const maxPositions = new Map<string, number>();
    for (const row of existingSubskills ?? []) {
      const current = maxPositions.get(row.category_id) ?? 0;
      const pos = Number.isFinite(row.position) ? row.position : 0;
      if (pos > current) {
        maxPositions.set(row.category_id, pos);
      }
    }

    const subskillRows = add_subskills.map((subskill) => {
      const current = maxPositions.get(subskill.category_id) ?? 0;
      const position =
        typeof subskill.position === "number" && Number.isFinite(subskill.position) ? subskill.position : current + 1;
      if (!Number.isFinite(subskill.position)) {
        maxPositions.set(subskill.category_id, position);
      }

      const row: Record<string, unknown> = {
        category_id: subskill.category_id,
        name: subskill.name,
        description: subskill.description,
        position,
        skill_id: subskill.skill_id,
      };

      if (Number.isFinite(subskill.rating_min)) {
        row.rating_min = subskill.rating_min;
      }
      if (Number.isFinite(subskill.rating_max)) {
        row.rating_max = subskill.rating_max;
      }
      if (Number.isFinite(subskill.priority)) {
        row.priority = subskill.priority;
      }

      return row;
    });

    const { data: insertedSubskills, error: insertSubskillsError } = await sbAdmin!
      .from("scorecard_subskills")
      .insert(subskillRows)
      .select("id");

    if (insertSubskillsError) {
      return { data: null, error: insertSubskillsError, notFound: false };
    }

    for (const subskill of insertedSubskills ?? []) {
      if (subskill?.id) {
        addedSubskillIds.push(subskill.id);
      }
    }
  }

  return {
    data: {
      added_category_ids: addedCategoryIds,
      removed_category_ids: remove_category_ids,
      added_subskill_ids: addedSubskillIds,
      removed_subskill_ids: remove_subskill_ids,
    },
    error: null,
    notFound: false,
  };
}

export async function deleteScorecardTemplate(args: { org_id: string; template_id: string }) {
  const { org_id, template_id } = args;

  const { data, error } = await sbAdmin!
    .from("scorecard_templates")
    .delete()
    .eq("id", template_id)
    .eq("org_id", org_id)
    .select("id");

  if (error) {
    return { data: null, error, notFound: false };
  }

  if (!data || data.length === 0) {
    return { data: null, error: null, notFound: true };
  }

  return {
    data: { id: data[0].id },
    error: null,
    notFound: false,
  };
}

export async function listScorecardCategoriesByTemplate(args: {
  org_id: string;
  scorecard_template_id: string;
  limit: number;
  offset: number;
}) {
  const { org_id, scorecard_template_id, limit, offset } = args;

  const { data: template, error: templateError } = await sbAdmin!
    .from("scorecard_templates")
    .select("id")
    .eq("id", scorecard_template_id)
    .eq("org_id", org_id)
    .maybeSingle();

  if (templateError) {
    return { data: null, count: 0, error: templateError };
  }

  if (!template) {
    return { data: [], count: 0, error: null };
  }

  const { data, error, count } = await sbAdmin!
    .from("scorecard_categories")
    .select("id, template_id, name, description, position, created_at", {
      count: "exact",
    })
    .eq("template_id", scorecard_template_id)
    .order("position", { ascending: true })
    .range(offset, offset + limit - 1);

  return { data, count: count ?? 0, error };
}

export async function listScorecardSubskillsByCategory(args: {
  org_id: string;
  category_id: string;
  limit: number;
  offset: number;
}) {
  const { org_id, category_id, limit, offset } = args;

  const { data: category, error: categoryError } = await sbAdmin!
    .from("scorecard_categories")
    .select("id, template:scorecard_templates!inner(org_id)")
    .eq("id", category_id)
    .eq("scorecard_templates.org_id", org_id)
    .maybeSingle();

  if (categoryError) {
    return { data: null, count: 0, error: categoryError };
  }

  if (!category) {
    return { data: [], count: 0, error: null };
  }

  const { data, error, count } = await sbAdmin!
    .from("scorecard_subskills")
    .select("id, category_id, skill_id, name, description, position, rating_min, rating_max, created_at", {
      count: "exact",
    })
    .eq("category_id", category_id)
    .order("position", { ascending: true })
    .range(offset, offset + limit - 1);

  return {
    data,
    count: count ?? 0,
    error,
  };
}
