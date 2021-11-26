import { ChakraProvider } from '@chakra-ui/react';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { QueryClient, QueryClientProvider } from 'react-query';

import '~/styles/main.scss';

const queryCache = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity
    }
  }
});

const App = ({ Component, pageProps }: AppProps) => (
  <>
    <Head>
      <title>
        AutoModerator Dashboard
      </title>

      <meta charSet = "utf-8" />
      <meta name = "viewport" content = "initial-scale=1.0, width=device-width" />
      {/* TODO(DD) */}
      {/* <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
				<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
				<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
				<link rel="manifest" href="/site.webmanifest" />
				<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#5bbad5" />
				<meta name="msapplication-TileColor" content="#2d89ef" />
				<meta name="theme-color" content="#ffffff" /> */}
    </Head>

    <QueryClientProvider client = {queryCache}>
      <ChakraProvider>
        <Component {...pageProps} />
      </ChakraProvider>
    </QueryClientProvider>
  </>
);

export default App;