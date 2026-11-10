<script>
  import { onMount } from 'svelte';
  import { dailySessionApi, groupFoodsByMeal, summarizeFoods } from '../../services/dailySessionService.js';
  import { notify } from '../../stores/index.js';

  let { session = null } = $props(); // DailySession with foods loaded

  let adding = $state(false);
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

  let editingFoodId = null;
  let editForm = null;

  const MEALS = [
    { id: 'breakfast', label: 'Breakfast', icon: '☀️' },
    { id: 'lunch', label: 'Lunch', icon: '🌞' },
    { id: 'dinner', label: 'Dinner', icon: '🌙' },
    { id: 'snack', label: 'Snack', icon: '🍎' },
  ];

  onMount(async () => {
    if (session && !session.foods) {
      try {
        const data = await dailySessionApi.get(session.id);
        session = data.data;
      } catch {
        // ignore
      }
    }
  });

  let foods = $derived(session?.foods ?? []);
  let meals = $derived(groupFoodsByMeal(foods));
  let totals = $derived(summarizeFoods(foods));

  async function addFood() {
    if (!session) {
      notify('Start a session first', 'error');
      return;
    }
    try {
      const data = await dailySessionApi.addFood(session.id, {
        meal_type: form.meal_type,
        food_name: form.food_name.trim(),
        calories: Number(form.calories) || 0,
        carbs_g: Number(form.carbs_g) || 0,
        protein_g: Number(form.protein_g) || 0,
        fat_g: Number(form.fat_g) || 0,
        quantity: Number(form.quantity) || 1,
        notes: form.notes?.trim() || null,
      });
      session = data.session;
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
    }
  }

  async function deleteFood(foodId) {
    if (!confirm('Remove this food?')) return;
    try {
      await dailySessionApi.removeFood(session.id, foodId);
      session = await dailySessionApi.get(session.id).then((d) => d.data);
      notify('Food removed', 'success');
    } catch (error) {
      notify(error.message || 'Failed to remove food', 'error');
    }
  }

  function startEdit(food) {
    editingFoodId = food.id;
    editForm = {
      meal_type: food.meal_type,
      food_name: food.food_name,
      calories: food.calories.toString(),
      carbs_g: food.carbs_g?.toString() || '',
      protein_g: food.protein_g?.toString() || '',
      fat_g: food.fat_g?.toString() || '',
      quantity: food.quantity.toString(),
      notes: food.notes || '',
    };
  }

  function cancelEdit() {
    editingFoodId = null;
    editForm = null;
  }

  async function saveEdit() {
    if (!editForm) return;
    try {
      await dailySessionApi.updateFood(session.id, editingFoodId, {
        meal_type: editForm.meal_type,
        food_name: editForm.food_name.trim(),
        calories: Number(editForm.calories) || 0,
        carbs_g: Number(editForm.carbs_g) || 0,
        protein_g: Number(editForm.protein_g) || 0,
        fat_g: Number(editForm.fat_g) || 0,
        quantity: Number(editForm.quantity) || 1,
        notes: editForm.notes?.trim() || null,
      });
      session = await dailySessionApi.get(session.id).then((d) => d.data);
      cancelEdit();
      notify('Food updated', 'success');
    } catch (error) {
      notify(error.message || 'Failed to update food', 'error');
    }
  }
</script>

<div class="rounded-2xl border border-brand-100 bg-white shadow-card p-4 sm:p-6">
  <div class="flex items-center justify-between mb-4">
    <div>
      <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Food Log</p>
      <p class="text-lg font-display font-extrabold text-ink-900">What did you eat today?</p>
    </div>
    {#if session}
      <button
        class="rounded-xl p-2 text-ink-400 hover:bg-brand-50 transition"
        onclick={() => (adding = !adding)}
        aria-label="Add food"
      >
        +
      </button>
    {/if}
  </div>

  {#if session}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {#each Object.entries(meals) as [mealType, mealFoods] (mealType)}
        <div class="rounded-xl border border-brand-100 bg-white p-3 shadow-sm">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-ink-700 capitalize">{mealType}</span>
            <span class="text-[10px] font-bold text-ink-400">{mealFoods.length}</span>
          </div>
          <div class="flex items-baseline gap-1">
            <span class="text-lg font-extrabold text-ink-900">{mealFoods.reduce((s, f) => s + Number(f.calories || 0), 0)}</span>
            <span class="text-xs font-bold text-ink-400">kcal</span>
          </div>
          <ul class="mt-2 space-y-1 max-h-32 overflow-y-auto">
            {#each mealFoods as food (food.id)}
              <li class="flex items-center justify-between px-2 py-1 rounded-lg hover:bg-brand-50 cursor-pointer group" onclick={() => startEdit(food)}>
                <span class="text-sm text-ink-700 truncate">{food.food_name}</span>
                <span class="text-xs font-bold text-ink-400">{food.calories} kcal</span>
                <span class="text-rose-500 opacity-0 group-hover:opacity-100 transition">×</span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>

    <div class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm mb-4">
      <div class="flex items-center justify-between mb-3">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400">Daily Totals</p>
      </div>
      <div class="grid grid-cols-4 gap-4">
        <div class="text-center">
          <div class="text-2xl font-extrabold text-ink-900">{totals.calories}</div>
          <div class="text-[10px] font-bold text-ink-400">kcal</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-extrabold text-emerald-500">{totals.carbs}</div>
          <div class="text-[10px] font-bold text-ink-400">carbs</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-extrabold text-rose-500">{totals.protein}</div>
          <div class="text-[10px] font-bold text-ink-400">protein</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-extrabold text-amber-500">{totals.fat}</div>
          <div class="text-[10px] font-bold text-ink-400">fat</div>
        </div>
      </div>
    </div>

    {#if adding}
      <form class="rounded-xl border border-brand-100 bg-white p-4 shadow-sm" onsubmit={(event) => { event.preventDefault(); addFood(); }}>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div class="col-span-2">
            <label class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400 mb-1">Food Name</label>
            <input
              bind:value={form.food_name}
              class="w-full px-3 py-2 rounded-lg border border-brand-200 text-sm focus:border-brand-500 focus:outline-none"
              placeholder="e.g. oatmeal with banana"
            />
          </div>
          <div>
            <label class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400 mb-1">Meal</label>
            <select bind:value={form.meal_type} class="w-full px-3 py-2 rounded-lg border border-brand-200 text-sm focus:border-brand-500 focus:outline-none">
              {#each MEALS as meal}
                <option value={meal.id}>{meal.icon} {meal.label}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400 mb-1">Calories</label>
            <input type="number" bind:value={form.calories} class="w-full px-3 py-2 rounded-lg border border-brand-200 text-sm focus:border-brand-500 focus:outline-none" placeholder="0" />
          </div>
          <div>
            <label class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400 mb-1">Qty</label>
            <input type="number" bind:value={form.quantity} class="w-full px-3 py-2 rounded-lg border border-brand-200 text-sm focus:border-brand-500 focus:outline-none" placeholder="1" />
          </div>
        </div>
        <div class="grid grid-cols-4 gap-3 mb-3">
          <div>
            <label class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400 mb-1">Carbs (g)</label>
            <input type="number" bind:value={form.carbs_g} class="w-full px-3 py-2 rounded-lg border border-brand-200 text-sm focus:border-brand-500 focus:outline-none" placeholder="0" />
          </div>
          <div>
            <label class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400 mb-1">Protein (g)</label>
            <input type="number" bind:value={form.protein_g} class="w-full px-3 py-2 rounded-lg border border-brand-200 text-sm focus:border-brand-500 focus:outline-none" placeholder="0" />
          </div>
          <div>
            <label class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400 mb-1">Fat (g)</label>
            <input type="number" bind:value={form.fat_g} class="w-full px-3 py-2 rounded-lg border border-brand-200 text-sm focus:border-brand-500 focus:outline-none" placeholder="0" />
          </div>
          <div class="flex items-end">
            <button
              type="submit"
              class="w-full rounded-xl py-3 border border-transparent bg-brand-gradient text-white font-bold shadow-glow hover:scale-[1.02] transition disabled:opacity-60"
            >
              Add Food
            </button>
          </div>
        </div>
        <div class="col-span-2">
          <label class="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-ink-400 mb-1">Notes</label>
          <textarea
            bind:value={form.notes}
            rows="2"
            class="w-full px-3 py-2 rounded-lg border border-brand-200 text-sm focus:border-brand-500 focus:outline-none"
            placeholder="e.g. felt energetic after"
          ></textarea>
        </div>
      </form>
    {/if}

    {#if editingFoodId !== null}
      <form class="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm" onsubmit={(event) => { event.preventDefault(); saveEdit(); }}>
        <h4 class="text-xs font-extrabold text-rose-600 uppercase tracking-[0.1em] mb-3">Edit Food</h4>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div class="col-span-2">
            <input
              bind:value={editForm.food_name}
              class="w-full px-3 py-2 rounded-lg border border-brand-200 text-sm focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <select bind:value={editForm.meal_type} class="w-full px-3 py-2 rounded-lg border border-brand-200 text-sm focus:border-brand-500 focus:outline-none">
              {#each MEALS as meal}
                <option value={meal.id}>{meal.label}</option>
              {/each}
            </select>
          </div>
          <div>
            <input type="number" bind:value={editForm.calories} class="w-full px-3 py-2 rounded-lg border border-brand-200 text-sm focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <button type="submit" class="w-full rounded-xl py-3 border border-transparent bg-brand-gradient text-white font-bold">Save</button>
            <button type="button" onclick={cancelEdit} class="w-full rounded-xl py-3 border border-brand-100 bg-white text-ink-700 font-bold">Cancel</button>
          </div>
        </div>
      </form>
    {/if}
  {/if}

  {#if !session}
    <div class="text-center py-10 text-ink-400 text-sm">
      No active session. Start tracking to log food.
    </div>
  {/if}
</div>