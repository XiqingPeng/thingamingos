FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY web ./web
COPY lib ./lib
COPY api ./api
COPY server.js ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 APP_BASE_PATH=/apps/thingamingos OBJECT_STORIES_DATA=/mydata/data/thingamingos BETTER_AUTH_URL=https://gpunion.hkust-gz.edu.cn
EXPOSE 3000
CMD ["node", "--env-file-if-exists=/mydata/data/thingamingos/runtime.env", "server.js"]
