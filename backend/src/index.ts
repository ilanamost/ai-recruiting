import 'dotenv/config'
import { createApp } from './app'
import { createPgStore } from './store/pg-store'

const port = process.env.PORT ?? 3001
const store = createPgStore(process.env.DATABASE_URL)
const app = createApp(store)

app.listen(port, () => {
  console.log(`backend listening on port ${port}`)
})
