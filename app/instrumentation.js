const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME || 'fowpy',
      'service.version': process.env.APP_VERSION || 'dev',
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  const shutdown = () => sdk.shutdown().catch((error) => {
    console.error('OpenTelemetry shutdown failed:', error.message);
  });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} else {
  console.warn('Dash0 telemetry is not configured; set OTEL_EXPORTER_OTLP_ENDPOINT to enable it');
}
