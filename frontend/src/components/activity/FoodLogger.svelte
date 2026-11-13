<script>
  import { dailySessionApi, groupFoodsByMeal, summarizeFoods } from '../../services/dailySessionService.js';
  import { notify } from '../../stores/index.js';

  let {
    session: sessionProp = undefined,
    onSessionChange = null,
  } = $props();

  let internalSession = $state(null);
  let adding = $state(false);
  let busy = $state(false);
  let form = $state({
    meal_type: 'breakfast',
    food_name: '',
    calories: '',
    carbs_g: '',
    protein_g: '',
    fat_g: '',
    quantity: 1,
    notes: '',
  });

  let editingFoodId = $state(null);
  let editForm = $state(null);

  const MEALS = [
    { id: 'breakfast', label: 'Breakfast' },
    { id: 'lunch', label: 'Lunch' },
    { id: 'dinner', label: 'Dinner' },
    { id: 'snack', label: 'Snack' },
  ];

  const ATHLETE_PRESETS = [
    { food_name: 'Banana', meal_type: 'snack', calories: 105, carbs_g: 27, protein_g: 1, fat_g: 0 },
    { food_name: 'Energy Gel (25g)', meal_type: 'snack', calories: 100, carbs_g: 25, protein_g: 0, fat_g: 0 },
    { food_name: 'Sports Drink 500ml', meal_type: 'snack', calories: 120, carbs_g: 30, protein_g: 0, fat_g: 0 },
    { food_name: 'Oatmeal + Honey', meal_type: 'breakfast', calories: 280, carbs_g: 52, protein_g: 8, fat_g: 4 },
    { food_name: 'Recovery Shake', meal_type: 'snack', calories: 220, carbs_g: 26, protein_g: 22, fat_g: 3 },
    { food_name: 'Rice + 2 Eggs', meal_type: 'lunch', calories: 360, carbs_g: 48, protein_g: 16, fat_g: 11 },
  ];

  const RECENT_KEY = 'trana:recent_foods:v1';
  let recentFoods = $state([]);

  function loadRecents() {
    try {
      const raw = globalThis.localStorage?.getItem(RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  recentFoods = loadRecents();

  function rememberFood(item) {
    try {
      const next = [
        item,
        ...recentFoods.filter((r) => r.food_name.toLowerCase() !== item.food_name.toLowerCase()),
      ].slice(0, 6);
      recentFoods = next;
      globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
  }

  let session = $derived(sessionProp !== undefined ? sessionProp : internalSession);

  function updateSession(next) {
    internalSession = next;
    onSessionChange?.(next);
  }

  $effect(() => {
    const s = session;
    if (s && s.id && s.foods === undefined) {
      dailySessionApi.get(s.id)
        .then((res) => {
          if (res?.data) updateSession(res.data);
        })
        .catch(() => {});
    }
  });

  let foods = $derived(session?.foods ?? []);
  let meals = $derived(groupFoodsByMeal(foods));
  let totals = $derived(summarizeFoods(foods));

  async function startAndOpenAdd() {
    busy = true;
    try {
      const res = await dailySessionApi.saveToday({});
      if (res?.data) {
        updateSession(res.data);
        adding = true;
      }
    } catch (error) {
      notify(error.message || "Failed to start today's session", 'error');
    } finally {
      busy = false;
    }
  }

  async function quickLogFood(item) {
    if (busy) return;
    busy = true;
    try {
      let targetSession = session;
      if (!targetSession) {
        const started = await dailySessionApi.saveToday({});
        targetSession = started?.data ?? null;
        if (targetSession) updateSession(targetSession);
      }
      if (!targetSession) throw new Error('Start a session first');
      const payload = {
        meal_type: item.meal_type || 'snack',
        food_name: item.food_name,
        calories: Number(item.calories) || 0,
        carbs_g: Number(item.carbs_g) || 0,
        protein_g: Number(item.protein_g) || 0,
        fat_g: Number(item.fat_g) || 0,
        quantity: 1,
        notes: null,
      };
      const data = await dailySessionApi.addFood(targetSession.id, payload);
      if (data?.session) updateSession(data.session);
      rememberFood(payload);

      const createdFoodId = data?.data?.id ?? data?.session?.foods?.at?.(-1)?.id;
      const targetSessionId = targetSession.id;
      notify(`Logged ${item.food_name}`, {
        tone: 'success',
        onUndo: createdFoodId
          ? async () => {
              const res = await dailySessionApi.removeFood(targetSessionId, createdFoodId);
              if (res?.session) updateSession(res.session);
            }
          : null,
      });
    } catch (error) {
      notify(error.message || 'Failed to add food', 'error');
    } finally {
      busy = false;
    }
  }

  async function addFood() {
    if (!session) {
      notify('Start a session first', 'error');
      return;
    }
    const name = form.food_name.trim();
    if (!name) {
      notify('Enter a food name', 'error');
      return;
    }
    busy = true;
    try {
      const payload = {
        meal_type: form.meal_type,
        food_name: name,
        calories: Number(form.calories) || 0,
        carbs_g: Number(form.carbs_g) || 0,
        protein_g: Number(form.protein_g) || 0,
        fat_g: Number(form.fat_g) || 0,
        quantity: Number(form.quantity) || 1,
        notes: form.notes?.trim() || null,
      };
      const data = await dailySessionApi.addFood(session.id, payload);
      if (data?.session) updateSession(data.session);
      rememberFood(payload);
      form = {
        meal_type: 'breakfast',
        food_name: '',
        calories: '',
        carbs_g: '',
        protein_g: '',
        fat_g: '',
        quantity: 1,
        notes: '',
      };
      adding = false;
      notify('Food added', 'success');
    } catch (error) {
      notify(error.message || 'Failed to add food', 'error');
    } finally {
      busy = false;
    }
  }

  async function deleteFood(foodId) {
    if (!session) return;
    busy = true;
    try {
      const res = await dailySessionApi.removeFood(session.id, foodId);
      if (res?.session) {
        updateSession(res.session);
      } else {
        const refreshed = await dailySessionApi.get(session.id);
        if (refreshed?.data) updateSession(refreshed.data);
      }
      if (editingFoodId === foodId) cancelEdit();
      notify('Food removed', 'success');
    } catch (error) {
      notify(error.message || 'Failed to remove food', 'error');
    } finally {
      busy = false;
    }
  }

  function startEdit(food) {
    adding = false;
    editingFoodId = food.id;
    editForm = {
      meal_type: food.meal_type,
      food_name: food.food_name,
      calories: String(food.calories ?? 0),
      carbs_g: food.carbs_g != null ? String(food.carbs_g) : '',
      protein_g: food.protein_g != null ? String(food.protein_g) : '',
      fat_g: food.fat_g != null ? String(food.fat_g) : '',
      quantity: String(food.quantity ?? 1),
      notes: food.notes || '',
    };
  }

  function cancelEdit() {
    editingFoodId = null;
    editForm = null;
  }

  async function saveEdit() {
    if (!editForm || !session || editingFoodId === null) return;
    const name = editForm.food_name.trim();
    if (!name) {
      notify('Enter a food name', 'error');
      return;
    }
    busy = true;
    try {
      const res = await dailySessionApi.updateFood(session.id, editingFoodId, {
        meal_type: editForm.meal_type,
        food_name: name,
        calories: Number(editForm.calories) || 0,
        carbs_g: Number(editForm.carbs_g) || 0,
        protein_g: Number(editForm.protein_g) || 0,
        fat_g: Number(editForm.fat_g) || 0,
        quantity: Number(editForm.quantity) || 1,
        notes: editForm.notes?.trim() || null,
      });
      if (res?.session) {
        updateSession(res.session);
      } else {
        const refreshed = await dailySessionApi.get(session.id);
        if (refreshed?.data) updateSession(refreshed.data);
      }
      cancelEdit();
      notify('Food updated', 'success');
    } catch (error) {
      notify(error.message || 'Failed to update food', 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="card p-4 sm:p-6">
  <div class="flex items-center justify-between gap-2 mb-4">
    <div>
      <p class="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Food Log</p>
      <p class="text-lg font-display font-extrabold text-ink-900">What did you eat today?</p>
    </div>
    {#if session}
      <button
        type="button"
        class="rounded-xl px-3 py-1.5 bg-brand-50 text-brand-700 text-xs font-bold hover:bg-brand-100 transition cursor-pointer"
        onclick={() => {
          adding = !adding;
          if (adding) cancelEdit();
        }}
      >
        {adding ? 'Close' : '+ Add food'}
      </button>
    {/if}
  </div>

  {#if session}
    <div class="grid grid-cols-2 gap-3 mb-4">
      {#each Object.entries(meals) as [mealType, mealFoods] (mealType)}
        <div class="card-flat p-3">
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs font-bold text-ink-700 capitalize">{mealType}</span>
            <span class="num-tabular text-[11px] font-bold text-ink-400">{mealFoods.length}</span>
          </div>
          <div class="num-tabular flex items-baseline gap-1">
            <span class="text-lg font-extrabold text-ink-900">{mealFoods.reduce((s, f) => s + Number(f.calories || 0), 0)}</span>
            <span class="text-xs font-bold text-ink-400">kcal</span>
          </div>
          {#if mealFoods.length > 0}
            <ul class="mt-2 space-y-1 max-h-28 overflow-y-auto">
              {#each mealFoods as food (food.id)}
                <li class="flex items-center gap-1">
                  <button
                    type="button"
                    class="flex-1 min-w-0 flex items-center justify-between px-2 py-1 rounded-lg hover:bg-white cursor-pointer text-left"
                    onclick={() => startEdit(food)}
                    title="Edit {food.food_name}"
                  >
                    <span class="text-xs text-ink-700 truncate">{food.food_name}</span>
                    <span class="num-tabular text-[11px] font-bold text-ink-400 shrink-0 ml-1">{food.calories}</span>
                  </button>
                  <button
                    type="button"
                    class="shrink-0 rounded px-1.5 py-0.5 text-xs text-rose-500 hover:bg-rose-50 cursor-pointer"
                    onclick={() => deleteFood(food.id)}
                    aria-label="Remove {food.food_name}"
                    title="Remove {food.food_name}"
                  >
                    ×
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>

    <div class="card-flat p-3.5 mb-4">
      <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-2">Daily Totals</p>
      <div class="num-tabular grid grid-cols-4 gap-2 text-center">
        <div>
          <div class="text-lg font-extrabold text-ink-900">{totals.calories}</div>
          <div class="text-[11px] font-bold text-ink-400">kcal</div>
        </div>
        <div>
          <div class="text-lg font-extrabold text-emerald-600">{totals.carbs}</div>
          <div class="text-[11px] font-bold text-ink-400">carbs</div>
        </div>
        <div>
          <div class="text-lg font-extrabold text-rose-500">{totals.protein}</div>
          <div class="text-[11px] font-bold text-ink-400">protein</div>
        </div>
        <div>
          <div class="text-lg font-extrabold text-amber-500">{totals.fat}</div>
          <div class="text-[11px] font-bold text-ink-400">fat</div>
        </div>
      </div>
    </div>

    {#if adding}
      <form class="rounded-xl border border-brand-100 bg-brand-50/30 p-4 shadow-sm space-y-3" onsubmit={(event) => { event.preventDefault(); addFood(); }}>
        <div>
          <p class="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1.5">1-tap athlete quick-add</p>
          <div class="flex flex-wrap gap-1.5">
            {#each (recentFoods.length ? recentFoods.concat(ATHLETE_PRESETS.filter((p) => !recentFoods.some((r) => r.food_name === p.food_name))).slice(0, 6) : ATHLETE_PRESETS) as preset (preset.food_name)}
              <button
                type="button"
                disabled={busy}
                onclick={() => quickLogFood(preset)}
                class="rounded-full border border-brand-100 bg-white px-2.5 py-1 text-[11px] font-bold text-ink-700 hover:border-brand-300 hover:bg-brand-50 transition cursor-pointer disabled:opacity-50"
              >
                + {preset.food_name} <span class="num-tabular text-ink-400">({preset.calories})</span>
              </button>
            {/each}
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <label for="food-name" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Food Name</label>
            <input
              id="food-name"
              bind:value={form.food_name}
              class="w-full px-3 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none"
              placeholder="e.g. oatmeal with banana"
            />
          </div>
          <div>
            <label for="food-meal" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Meal</label>
            <select id="food-meal" bind:value={form.meal_type} class="w-full px-3 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none">
              {#each MEALS as meal (meal.id)}
                <option value={meal.id}>{meal.label}</option>
              {/each}
            </select>
          </div>
          <div>
            <label for="food-calories" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Calories</label>
            <input id="food-calories" type="number" min="0" bind:value={form.calories} class="num-tabular w-full px-3 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none" placeholder="0" />
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <label for="food-carbs" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Carbs (g)</label>
            <input id="food-carbs" type="number" min="0" bind:value={form.carbs_g} class="num-tabular w-full px-2.5 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none" placeholder="0" />
          </div>
          <div>
            <label for="food-protein" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Protein (g)</label>
            <input id="food-protein" type="number" min="0" bind:value={form.protein_g} class="num-tabular w-full px-2.5 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none" placeholder="0" />
          </div>
          <div>
            <label for="food-fat" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Fat (g)</label>
            <input id="food-fat" type="number" min="0" bind:value={form.fat_g} class="num-tabular w-full px-2.5 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none" placeholder="0" />
          </div>
          <div>
            <label for="food-qty" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Qty</label>
            <input id="food-qty" type="number" min="1" bind:value={form.quantity} class="num-tabular w-full px-2.5 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none" placeholder="1" />
          </div>
        </div>
        <div>
          <label for="food-notes" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Notes</label>
          <textarea
            id="food-notes"
            bind:value={form.notes}
            rows="2"
            class="w-full px-3 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none"
            placeholder="e.g. felt energetic after"
          ></textarea>
        </div>
        <button
          type="submit"
          disabled={busy}
          class="btn-primary w-full"
        >
          Add Food
        </button>
      </form>
    {/if}

    {#if editingFoodId !== null && editForm}
      <form class="rounded-xl border border-brand-200 bg-brand-50/40 p-4 shadow-sm space-y-3" onsubmit={(event) => { event.preventDefault(); saveEdit(); }}>
        <h4 class="text-xs font-extrabold text-brand-700 uppercase tracking-[0.1em]">Edit Food</h4>
        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <label for="edit-food-name" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Food Name</label>
            <input
              id="edit-food-name"
              bind:value={editForm.food_name}
              class="w-full px-3 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label for="edit-food-meal" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Meal</label>
            <select id="edit-food-meal" bind:value={editForm.meal_type} class="w-full px-3 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none">
              {#each MEALS as meal (meal.id)}
                <option value={meal.id}>{meal.label}</option>
              {/each}
            </select>
          </div>
          <div>
            <label for="edit-food-calories" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Calories</label>
            <input id="edit-food-calories" type="number" min="0" bind:value={editForm.calories} class="num-tabular w-full px-3 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none" />
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <label for="edit-food-carbs" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Carbs (g)</label>
            <input id="edit-food-carbs" type="number" min="0" bind:value={editForm.carbs_g} class="num-tabular w-full px-2.5 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label for="edit-food-protein" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Protein (g)</label>
            <input id="edit-food-protein" type="number" min="0" bind:value={editForm.protein_g} class="num-tabular w-full px-2.5 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label for="edit-food-fat" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Fat (g)</label>
            <input id="edit-food-fat" type="number" min="0" bind:value={editForm.fat_g} class="num-tabular w-full px-2.5 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label for="edit-food-qty" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Qty</label>
            <input id="edit-food-qty" type="number" min="1" bind:value={editForm.quantity} class="num-tabular w-full px-2.5 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none" />
          </div>
        </div>
        <div>
          <label for="edit-food-notes" class="block text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-400 mb-1">Notes</label>
          <input id="edit-food-notes" bind:value={editForm.notes} class="w-full px-3 py-2 rounded-lg border border-brand-200 bg-white text-sm focus:border-brand-500 focus:outline-none" placeholder="Optional note" />
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} class="btn-primary flex-1 !py-2 !text-xs">Save</button>
          <button type="button" onclick={cancelEdit} class="btn-ghost flex-1 !py-2 !text-xs">Cancel</button>
          <button type="button" disabled={busy} onclick={() => deleteFood(editingFoodId)} class="rounded-xl px-3 py-2 border border-rose-200 bg-rose-50 text-rose-600 text-xs font-bold cursor-pointer disabled:opacity-60">Delete</button>
        </div>
      </form>
    {/if}
  {:else}
    <div class="text-center py-6 space-y-3">
      <p class="text-ink-500 text-sm font-semibold">No active session yet today.</p>
      <p class="text-ink-400 text-xs">Open today's session or tap any quick snack to start logging right away.</p>
      <div class="flex flex-wrap justify-center gap-1.5">
        {#each ATHLETE_PRESETS.slice(0, 4) as preset (preset.food_name)}
          <button
            type="button"
            disabled={busy}
            onclick={() => quickLogFood(preset)}
            class="rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-700 hover:bg-brand-100 transition cursor-pointer disabled:opacity-50"
          >
            + {preset.food_name}
          </button>
        {/each}
      </div>
      <button
        type="button"
        disabled={busy}
        onclick={startAndOpenAdd}
        class="inline-flex items-center justify-center rounded-xl px-4 py-2.5 bg-brand-50 text-brand-700 text-xs font-bold hover:bg-brand-100 transition cursor-pointer disabled:opacity-60"
      >
        Start &amp; log food
      </button>
    </div>
  {/if}
</div>
