# Setting Up Modal CI/CD with GitHub Actions

This guide explains how to set up automatic deployment of Modal apps when you push changes to GitHub.

## Prerequisites

1. A Modal account (sign up at https://modal.com)
2. Modal CLI installed locally (for getting tokens)
3. GitHub repository with Actions enabled

## Step 1: Get Modal Token

1. Install Modal CLI locally:
   ```bash
   pip install modal
   ```

2. Authenticate with Modal:
   ```bash
   modal token new
   ```

3. Get your token credentials:
   ```bash
   modal token list
   ```

   Or find them in your Modal config file:
   - Linux/Mac: `~/.modal/config.toml`
   - Windows: `%USERPROFILE%\.modal\config.toml`

   The file looks like:
   ```toml
   [default]
   token_id = "ak-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   token_secret = "as-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   ```

## Step 2: Add Secrets to GitHub

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Add these two secrets:

   **MODAL_TOKEN_ID**
   - Name: `MODAL_TOKEN_ID`
   - Value: Your token_id from Modal (starts with `ak-`)

   **MODAL_TOKEN_SECRET**
   - Name: `MODAL_TOKEN_SECRET`
   - Value: Your token_secret from Modal (starts with `as-`)

## Step 3: Choose Your Workflow

We've created two GitHub Actions workflows:

### Option 1: Simple Workflow (`deploy-modal.yml`)
- Deploys on every push to main that changes Modal files
- Simple and straightforward
- Good for basic setups

### Option 2: Smart Workflow (`deploy-modal-smart.yml`)
- Only deploys apps that actually changed
- Uses change detection to minimize deployments
- Supports manual trigger with "Deploy all" option
- Better for production

## Step 4: Activate the Workflow

The workflows are already in `.github/workflows/`. They will activate automatically when you:

1. Push changes to `modal_apps/` directory
2. Manually trigger from GitHub Actions tab
3. Merge a PR that modifies Modal apps

## Step 5: Test the Deployment

1. Make a small change to a Modal app:
   ```bash
   echo "# Deployment test" >> modal_apps/workflow_executor.py
   ```

2. Commit and push:
   ```bash
   git add .
   git commit -m "test: Trigger Modal deployment"
   git push
   ```

3. Check GitHub Actions tab to see the deployment running

4. Verify in Modal Dashboard:
   - Go to https://modal.com/apps
   - Check that your apps show recent deployment

## Manual Deployment

You can manually trigger deployment from GitHub:

1. Go to Actions tab in your repository
2. Select "Smart Modal Deployment" workflow
3. Click "Run workflow"
4. Optionally check "Deploy all Modal apps"
5. Click "Run workflow" button

## Troubleshooting

### Deployment fails with authentication error
- Check that both `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` are set correctly
- Ensure tokens are still valid (not revoked)

### Apps not showing in Modal dashboard
- Check the deployment logs in GitHub Actions
- Verify the app names match what's in Modal dashboard
- Try manual deployment to see detailed errors

### Workflow not triggering
- Ensure you're pushing to the `main` branch
- Check that files changed are in `modal_apps/` directory
- Verify Actions are enabled for your repository

## Monitoring

- GitHub Actions: Check the Actions tab for deployment history
- Modal Dashboard: Monitor app status at https://modal.com/apps
- Modal Logs: View execution logs in Modal dashboard

## Rollback

If a deployment causes issues:

1. Revert the commit:
   ```bash
   git revert HEAD
   git push
   ```

2. Or manually deploy a previous version:
   ```bash
   git checkout <previous-commit>
   cd modal_apps
   modal deploy workflow_executor.py
   ```

## Notes

- Deployments typically take 1-2 minutes
- Modal apps are versioned automatically
- Old versions remain accessible for rollback
- Scheduled functions (cron jobs) are updated automatically