# Usa uma imagem oficial e leve do Node.js
FROM node:20-slim

# Instala todas as dependências gráficas que o Chrome/Puppeteer exige
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Define a pasta de trabalho dentro do servidor
WORKDIR /app

# Copia os ficheiros de dependências e instala
COPY package*.json ./
RUN npm install

# Copia o resto do código do bot
COPY . .

# Comando para iniciar o seu bot
CMD ["node", "index.js"]