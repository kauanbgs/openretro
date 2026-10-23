FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs turn.mjs ./
COPY public ./public
USER node
ENV HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "server.mjs"]
