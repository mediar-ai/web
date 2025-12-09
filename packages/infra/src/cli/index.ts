/**
 * Mediar Infrastructure CLI
 * Command-line tool for managing Azure infrastructure
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from 'dotenv';

// Load environment variables
config();

import {
  startVm,
  stopVm,
  restartVm,
  deallocateVm,
  getVmState,
  getVmPublicIp,
  isAzureConfigured,
} from '../azure/index.js';
import { initTelemetry, shutdownTelemetry, createAuditContext } from '../telemetry/index.js';

const program = new Command();

program
  .name('mediar-infra')
  .description('Mediar Infrastructure Management CLI')
  .version('0.1.0');

// Initialize telemetry for CLI operations
program.hook('preAction', () => {
  initTelemetry({ serviceName: 'mediar-infra-cli' });
});

program.hook('postAction', async () => {
  await shutdownTelemetry();
});

// VM commands
const vm = program.command('vm').description('VM operations');

vm.command('start <resourceId>')
  .description('Start a VM')
  .action(async (resourceId: string) => {
    if (!isAzureConfigured()) {
      console.error(chalk.red('Error: Azure credentials not configured'));
      process.exit(1);
    }

    const spinner = ora('Starting VM...').start();
    try {
      const result = await startVm(resourceId, createAuditContext('cli', 'cli'));
      spinner.succeed(chalk.green(result.message));
      console.log(chalk.gray(`  Power state: ${result.state?.powerState}`));
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

vm.command('stop <resourceId>')
  .description('Stop a VM')
  .action(async (resourceId: string) => {
    if (!isAzureConfigured()) {
      console.error(chalk.red('Error: Azure credentials not configured'));
      process.exit(1);
    }

    const spinner = ora('Stopping VM...').start();
    try {
      const result = await stopVm(resourceId, createAuditContext('cli', 'cli'));
      spinner.succeed(chalk.green(result.message));
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

vm.command('restart <resourceId>')
  .description('Restart a VM')
  .action(async (resourceId: string) => {
    if (!isAzureConfigured()) {
      console.error(chalk.red('Error: Azure credentials not configured'));
      process.exit(1);
    }

    const spinner = ora('Restarting VM...').start();
    try {
      const result = await restartVm(resourceId, createAuditContext('cli', 'cli'));
      spinner.succeed(chalk.green(result.message));
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

vm.command('deallocate <resourceId>')
  .description('Deallocate a VM (release compute resources)')
  .action(async (resourceId: string) => {
    if (!isAzureConfigured()) {
      console.error(chalk.red('Error: Azure credentials not configured'));
      process.exit(1);
    }

    const spinner = ora('Deallocating VM...').start();
    try {
      const result = await deallocateVm(resourceId, createAuditContext('cli', 'cli'));
      spinner.succeed(chalk.green(result.message));
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

vm.command('status <resourceId>')
  .description('Get VM status')
  .action(async (resourceId: string) => {
    if (!isAzureConfigured()) {
      console.error(chalk.red('Error: Azure credentials not configured'));
      process.exit(1);
    }

    const spinner = ora('Getting VM status...').start();
    try {
      const state = await getVmState(resourceId);
      const ip = await getVmPublicIp(resourceId);
      spinner.stop();

      console.log(chalk.bold('\nVM Status:'));
      console.log(`  Power State: ${state.powerState === 'running' ? chalk.green(state.powerState) : chalk.yellow(state.powerState)}`);
      console.log(`  Provisioning State: ${state.provisioningState}`);
      console.log(`  Extensions Ready: ${state.extensionsReady ? chalk.green('Yes') : chalk.red('No')}`);
      if (state.blockedExtensions.length > 0) {
        console.log(`  Blocked Extensions: ${chalk.red(state.blockedExtensions.join(', '))}`);
      }
      if (ip) {
        console.log(`  Public IP: ${chalk.cyan(ip)}`);
      }
    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

// Config command
program
  .command('config')
  .description('Show configuration status')
  .action(() => {
    console.log(chalk.bold('\nConfiguration Status:'));
    console.log(`  Azure Configured: ${isAzureConfigured() ? chalk.green('Yes') : chalk.red('No')}`);
    console.log(`  OTEL Endpoint: ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || chalk.gray('(not set)')}`);
    console.log(`  Subscription ID: ${process.env.AZURE_SUBSCRIPTION_ID ? chalk.green('Set') : chalk.red('Not set')}`);
    console.log(`  Tenant ID: ${process.env.AZURE_TENANT_ID ? chalk.green('Set') : chalk.gray('Not set (using CLI auth)')}`);
  });

program.parse();
