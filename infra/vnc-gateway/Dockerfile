FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Download noVNC
RUN apk add --no-cache wget unzip && \
    wget -q https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.zip -O novnc.zip && \
    unzip -q novnc.zip && \
    mv noVNC-1.4.0 novnc && \
    rm novnc.zip && \
    apk del wget unzip

COPY server.js ./

EXPOSE 8080

CMD ["node", "server.js"]
