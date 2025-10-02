@echo off
echo Deploying Modal workflow executor with parser output fix...
set PYTHONPATH=.
set PYTHONIOENCODING=utf-8
python -m modal deploy modal_apps/workflow_executor.py
echo.
echo Deployment completed!
echo Parser output will now be fully preserved in the database.