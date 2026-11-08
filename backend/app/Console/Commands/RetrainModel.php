<?php

namespace App\Console\Commands;

use App\Services\MlClient;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;

/**
 * Nightly retrain hook.
 *
 * The model itself is trained in Python, so this command shells out to the
 * ML project (or a Render/Railway job endpoint) and then asks the service to
 * reload the fresh artifact into memory.
 */
class RetrainModel extends Command
{
    protected $signature = 'trana:retrain
                            {--no-reload : Only retrain, do not ask the service to reload}
                            {--source=synth : synth, csv or supabase}';

    protected $description = 'Retrain the TRANA duration model from collected activity data';

    public function handle(MlClient $ml): int
    {
        $command = (string) env(
            'ML_TRAIN_COMMAND',
            'cd ../ml-service && .venv/bin/python -m training.train --source=supabase'
        );

        if ($source = $this->option('source')) {
            $command = str_replace('--source=supabase', '--source='.$source, $command);
        }

        $this->info('Training: '.$command);
        $result = Process::timeout(1800)->run($command);

        $this->line($result->output());

        if ($result->failed()) {
            $this->error('Training failed: '.$result->errorOutput());

            return self::FAILURE;
        }

        if (! $this->option('no-reload')) {
            try {
                $reload = $ml->reload();
                $this->info('Model reload requested: '.json_encode($reload));
            } catch (\Throwable $e) {
                $this->warn('Could not reload the service: '.$e->getMessage());
            }
        }

        return self::SUCCESS;
    }
}
