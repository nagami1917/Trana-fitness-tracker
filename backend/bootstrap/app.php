<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        // Vercel / any reverse proxy terminates TLS in front of the app.
        $middleware->trustProxies(at: '*');

        // Authentication tokens are stored in HttpOnly cookies. Translate the
        // cookie into a server-side Sanctum bearer token and verify Origin/CSRF
        // headers before API writes; the token is never exposed to JavaScript.
        $middleware->api(append: [
            \App\Http\Middleware\AuthenticateFromHttpOnlyCookie::class,
            \App\Http\Middleware\VerifyApiCsrf::class,
        ]);

        // Laravel's route middleware priority can move auth:sanctum ahead of
        // ordinary API middleware. These adapters must run first so the auth
        // cookie is available to Sanctum, and CSRF checks precede route auth.
        $middleware->prependToPriorityList(
            \Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests::class,
            \App\Http\Middleware\AuthenticateFromHttpOnlyCookie::class,
        );
        $middleware->prependToPriorityList(
            \Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests::class,
            \App\Http\Middleware\VerifyApiCsrf::class,
        );

        $middleware->alias([
            'abilities' => \Laravel\Sanctum\Http\Middleware\CheckAbilities::class,
            'ability' => \Laravel\Sanctum\Http\Middleware\CheckForAnyAbility::class,
            // Admin console: server-side role gate + suspension re-check.
            'admin' => \App\Http\Middleware\EnsureAdmin::class,
            'ensure.active' => \App\Http\Middleware\EnsureNotSuspended::class,
            'ensure.verified' => \App\Http\Middleware\EnsureVerifiedEmail::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson()
        );

        // Error monitoring: group and persist genuine production faults as a
        // side effect of the handler's report(). This is the single reliable
        // hook — route-level exceptions are rendered inside
        // Routing\Pipeline and never reach global middleware. Returning
        // null (not false) keeps default logging and JSON rendering
        // exactly as they were; deliberate 4xx answers never get here
        // (internalDontReport) and are filtered again below regardless.
        $exceptions->reportable(function (\Throwable $e) {
            if (! \App\Services\ErrorMonitor::isServerFault($e)) {
                return;
            }
            if (! app()->bound('request')) {
                return; // console/queue faults belong to the default log
            }
            $request = app('request');
            if ($request instanceof Request) {
                \App\Services\ErrorMonitor::recordServer($e, $request);
            }
        });

        // Never leak stack traces or SQL to the client, even in debug mode.
        $exceptions->render(function (\Throwable $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            if ($e instanceof \Illuminate\Validation\ValidationException) {
                return response()->json([
                    'message' => $e->getMessage(),
                    'errors' => $e->errors(),
                ], 422);
            }

            if ($e instanceof \Illuminate\Auth\AuthenticationException) {
                return response()->json(['message' => 'Unauthenticated.'], 401);
            }

            if ($e instanceof \Symfony\Component\HttpKernel\Exception\NotFoundHttpException) {
                return response()->json(['message' => 'Resource not found.'], 404);
            }

            $status = $e instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface
                ? $e->getStatusCode()
                : 500;

            return response()->json([
                'message' => $status === 500
                    ? 'Something went wrong on our side.'
                    : $e->getMessage(),
            ], $status);
        });
    })->create();
