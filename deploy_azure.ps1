# deploy_azure.ps1
# PowerShell Script to Deploy Terrain-AI to Azure Web App for Containers

# 1. Update PATH to include Azure CLI if it was just installed and is not yet in the session PATH
$cliPaths = @(
    "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin",
    "C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin"
)

foreach ($path in $cliPaths) {
    if (Test-Path $path) {
        if ($env:Path -notlike "*$path*") {
            Write-Host "Adding Azure CLI path ($path) to current session PATH..." -ForegroundColor Cyan
            $env:Path = "$path;" + $env:Path
        }
    }
}

# 2. Check if Azure CLI is available
if (!(Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Error "Azure CLI ('az') was not found in the PATH. If you just installed it, please restart your terminal or VS Code and run the script again."
    Exit 1
}

Write-Host "Azure CLI is available!" -ForegroundColor Green

# 3. Authenticate with Azure if not already logged in
Write-Host "Checking Azure authentication status..." -ForegroundColor Cyan
$account = az account show --query name -o tsv 2>$null
if ($null -eq $account -or $account -eq "") {
    Write-Host "You are not logged in. Initiating Azure login with device code..." -ForegroundColor Yellow
    az login --use-device-code
    $account = az account show --query name -o tsv
}
Write-Host "Logged in to subscription: $account" -ForegroundColor Green

# 4. Generate names for Azure resources
# Using a random suffix to ensure names are globally unique for ACR and Web App
$uniqueSuffix = Get-Random -Minimum 1000 -Maximum 9999
$RG_NAME = "rg-terrain-ai"
$LOCATION = "eastasia" # Allowed location by subscription policy
$ACR_NAME = "terrainregistry$uniqueSuffix" # Alphanumeric, 5-50 chars
$PLAN_NAME = "plan-terrain-ai"
$WEB_APP_NAME = "terrain-ai-web-$uniqueSuffix"

Write-Host "--- Resource Configuration ---" -ForegroundColor Green
Write-Host "Resource Group: $RG_NAME"
Write-Host "Location:       $LOCATION"
Write-Host "Registry (ACR): $ACR_NAME"
Write-Host "Service Plan:   $PLAN_NAME"
Write-Host "Web App Name:   $WEB_APP_NAME"
Write-Host "------------------------------"

# 5. Create Resource Group
Write-Host "Creating Resource Group '$RG_NAME' in '$LOCATION'..." -ForegroundColor Cyan
az group create --name $RG_NAME --location $LOCATION

# 6. Create Azure Container Registry (ACR)
Write-Host "Creating Azure Container Registry '$ACR_NAME'..." -ForegroundColor Cyan
az acr create --resource-group $RG_NAME --name $ACR_NAME --sku Basic

# 7. Enable Admin Credentials on ACR
Write-Host "Enabling Admin user on Azure Container Registry..." -ForegroundColor Cyan
az acr update --name $ACR_NAME --admin-enabled true

# 8. Get ACR credentials
$acrUser = az acr credential show --name $ACR_NAME --query "username" -o tsv
$acrPassword = az acr credential show --name $ACR_NAME --query "passwords[0].value" -o tsv

# 9. Build and push the Docker image using ACR Tasks
Write-Host "Building Docker image in the cloud using ACR Tasks..." -ForegroundColor Cyan
# We run from the root, but the Dockerfile is in terrain-predictor folder.
# The context path passed to az acr build is 'terrain-predictor'
az acr build --registry $ACR_NAME --image terrain-ai:latest ./terrain-predictor

# 10. Create App Service Plan (Basic Linux B1)
Write-Host "Creating App Service Plan '$PLAN_NAME' (B1 SKU)..." -ForegroundColor Cyan
az appservice plan create --name $PLAN_NAME --resource-group $RG_NAME --sku B1 --is-linux --location $LOCATION

# 11. Create Web App for Containers
Write-Host "Creating Web App '$WEB_APP_NAME'..." -ForegroundColor Cyan
az webapp create --name $WEB_APP_NAME --resource-group $RG_NAME --plan $PLAN_NAME --deployment-container-image-name "$ACR_NAME.azurecr.io/terrain-ai:latest"

# 12. Configure Web App Container settings with ACR Credentials
Write-Host "Configuring Web App container registry credentials..." -ForegroundColor Cyan
az webapp config container set --name $WEB_APP_NAME --resource-group $RG_NAME --docker-custom-image-name "$ACR_NAME.azurecr.io/terrain-ai:latest" --docker-registry-server-url "https://$ACR_NAME.azurecr.io" --docker-registry-server-user $acrUser --docker-registry-server-password $acrPassword

# 13. Configure port mapping settings (WEBSITES_PORT=7860)
Write-Host "Configuring port routing (WEBSITES_PORT=7860)..." -ForegroundColor Cyan
az webapp config appsettings set --name $WEB_APP_NAME --resource-group $RG_NAME --settings WEBSITES_PORT=7860

# 14. Deployment complete!
$webAppUrl = "https://$WEB_APP_NAME.azurewebsites.net"
Write-Host "`n===============================================" -ForegroundColor Green
Write-Host "DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
Write-Host "Your website is live at: $webAppUrl" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
