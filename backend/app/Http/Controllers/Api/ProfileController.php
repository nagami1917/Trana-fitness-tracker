<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreProfileRequest;
use App\Http\Requests\UpdateFitnessLevelRequest;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Requests\UpdateWeightRequest;
use App\Http\Resources\ProfileResource;
use App\Models\FitnessProfile;
use App\Models\User;
use App\Models\WeightLog;
use App\Services\ActivityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Step 4 — the athlete's fitness profile.
 *
 *   POST           /api/profile                 create (201 / 409 if it exists)
 *   GET            /api/profile                 view
 *   PUT|PATCH      /api/profile                 edit any subset
 *   PATCH          /api/profile/weight          update body mass
 *   PATCH          /api/profile/fitness-level   update the 1–5 fitness level
 *
 * Every response is the full profile resource. Writes go to `fitness_profiles`;
 * the spec's `user_profiles` view is a read-only projection of the same row, so
 * the prediction service and SQL clients always see identical values.
 */
class ProfileController extends Controller
{
    /** Columns a profile write may touch. */
    private const PROFILE_FIELDS = [
        'weight_kg', 'height_cm', 'birth_year', 'sex', 'sweat_profile',
        'experience_level', 'activity_experience', 'typical_temperature_c',
        'city', 'units',
    ];

    public function __construct(private readonly ActivityService $activities)
    {
    }

    public function store(StoreProfileRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        if ($user->fitnessProfile()->exists()) {
            return response()->json([
                'message' => 'This account already has a fitness profile. Use PUT or PATCH /api/profile to edit it.',
                'data' => (new ProfileResource($user->fresh()))->toArray($request),
            ], 409);
        }

        $validated = $request->validated();

        if (isset($validated['name'])) {
            $user->update(['name' => $validated['name']]);
        }

        $fields = $this->profileFields($validated);
        if (array_key_exists('onboarded', $validated)) {
            $fields['onboarded_at'] = $validated['onboarded'] ? now() : null;
        }

        $user->fitnessProfile()->create($fields);
        $user->ensureGoals();

        return response()->json(
            ['data' => (new ProfileResource($user->fresh()))->toArray($request)],
            201
        );
    }

    public function show(Request $request): JsonResponse
    {
        return response()->json([
            'data' => (new ProfileResource($request->user()->fresh() ?? $request->user()))->toArray($request),
        ]);
    }

    public function update(UpdateProfileRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $profile = $user->ensureProfile();
        $goal = $user->ensureGoals();

        $validated = $request->validated();

        if (isset($validated['name'])) {
            $user->update(['name' => $validated['name']]);
        }

        $profileFields = $this->profileFields($validated);
        if (array_key_exists('onboarded', $validated)) {
            $profileFields['onboarded_at'] = $validated['onboarded'] ? now() : null;
        }
        if ($profileFields) {
            $profile->update($profileFields);
        }

        $goalFields = [];
        $map = [
            'daily_calorie_goal' => 'daily_calories',
            'daily_distance_goal_km' => 'daily_distance_km',
            'daily_active_min_goal' => 'daily_active_min',
            'weekly_calorie_goal' => 'weekly_calories',
            'weekly_distance_goal_km' => 'weekly_distance_km',
            'daily_carb_goal_g' => 'carb_target_g',
        ];
        foreach ($map as $input => $column) {
            if (isset($validated[$input])) {
                $goalFields[$column] = $validated[$input];
            }
        }
        if ($goalFields) {
            $goal->update($goalFields);
        }

        return response()->json(['data' => (new ProfileResource($user->fresh()))->toArray($request)]);
    }

    /** PATCH /api/profile/weight — body mass drives every kcal/fluid estimate. */
    public function updateWeight(UpdateWeightRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $weightKg = (float) $request->validated('weight_kg');
        $user->ensureProfile()->update(['weight_kg' => $weightKg]);

        // Mirror into the daily timeline so PATCH-built weight history shows
        // up in the Analytics trend like POST /weight-logs entries do.
        WeightLog::record($user, $weightKg);

        return response()->json(['data' => (new ProfileResource($user->fresh()))->toArray($request)]);
    }

    /**
     * PATCH /api/profile/fitness-level
     *
     * A level the athlete chooses is marked as user-owned, so logging sessions
     * no longer overwrites it with the activity-count heuristic. Sending
     * source=auto hands it back to that heuristic and recomputes it now.
     */
    public function updateFitnessLevel(UpdateFitnessLevelRequest $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $profile = $user->ensureProfile();
        $validated = $request->validated();

        $level = $validated['fitness_level'] ?? $validated['experience_level'] ?? null;

        if ($level !== null) {
            $profile->update([
                'experience_level' => (int) $level,
                'fitness_level_source' => FitnessProfile::LEVEL_SOURCE_USER,
            ]);
        } else {
            $profile->update(['fitness_level_source' => FitnessProfile::LEVEL_SOURCE_AUTO]);
            $this->activities->syncExperienceLevel($user, force: true);
        }

        return response()->json(['data' => (new ProfileResource($user->fresh()))->toArray($request)]);
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function profileFields(array $validated): array
    {
        $fields = array_intersect_key($validated, array_flip(self::PROFILE_FIELDS));

        if (array_key_exists('experience_level', $fields)) {
            $fields['experience_level'] = (int) $fields['experience_level'];
            // An explicit level is the athlete's call, not the heuristic's.
            $fields['fitness_level_source'] = FitnessProfile::LEVEL_SOURCE_USER;
        }

        if (array_key_exists('activity_experience', $fields) && $fields['activity_experience'] !== null) {
            $fields['activity_experience'] = round((float) $fields['activity_experience'], 1);
        }

        return $fields;
    }
}
