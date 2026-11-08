<?php

namespace App\Console\Commands;

use App\Services\MlClient;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;

/**
 * Explicit retrain hook. This is not scheduled automatically.
 *
 * Training and deploying the new artifacts requires a configured Python
 * environment, an appropriate data source, and permission to use that data.
 */
class RetrainModel extends Command
{
    protected $signature = 'trana:retrain
                            {--no-reload : Only retrain, do not ask the service to reload}
                            {--source= : Required source: synth, csv or supabase}';

    protected $description = 'Retrain the TRANA duration model from collected activity data';

    public function handle(MlClient $ml): int
    {
        $source = $this->option('source');
        if (! in_array($source, ['synth', 'csv', 'supabase'], true)) {
            $this->error('Choose an explicit --source: synth, csv or supabase.');

            return self::FAILURE;
        }

        $command = (string) env(
            'ML_TRAIN_COMMAND',
            'cd ../ml && .venv/bin/python -m duration_model.train --source=supabase'
        );
        if (! str_contains($command, '--source=supabase')) {
            $this->error('ML_TRAIN_COMMAND must contain --source=supabase as a source placeholder.');

            return self::FAILURE;
        }
        $command = str_replace('--source=supabase', '--source='.$source, $command);

        // A custom command may contain secrets; never print it.
        $this->info('Starting model training.');
        $result = Process::timeout(1800)->run($command);

        $this->line($result->output());

        if ($result->failed()) {
            $this->error('Training failed: '.$result->errorOutput());

            return self::FAILURE;
        }

        if (! $this->option('no-reload')) {
            try {
                $reload = $ml->reload();
                if (! ($reload['reloaded'] ?? false)) {
                    $this->error('Training finished, but the ML service did not reload the model.');

                    return self::FAILURE;
                }
                $this->info('Model reloaded.');
            } catch (\Throwable $e) {
                $this->error('Training finished, but the ML service could not reload the model.');

                return self::FAILURE;
            }
        }

        return self::SUCCESS;
    }
}
