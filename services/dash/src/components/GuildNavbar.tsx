import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Box,
  Text,
  Button,
  Flex,
  IconButton,
  Heading,
  useDisclosure,
  VStack,
  useColorModeValue,
  useColorMode
} from '@chakra-ui/react';
import { FiMenu, FiX } from 'react-icons/fi';
import { MoonIcon, SunIcon } from '@chakra-ui/icons';

const GuildNavbar = () => {
  const router = useRouter();
  const { isOpen, onToggle } = useDisclosure();

  const icon = useColorModeValue(<MoonIcon />, <SunIcon />);
  const { toggleColorMode, colorMode } = useColorMode();

  const gray = colorMode === 'dark' ? 'gray.700' : 'gray.200';
  const blue = colorMode === 'dark' ? 'blue.200' : 'blue.600';

  const { id } = router.query;

  return (
    <Flex as = "nav" align = "center"
      justifyContent = "space-between" wrap = "wrap"
      px = {{ base: 50, lg: 4 }}>
      <Flex d = {{ base: 'block', lg: 'none' }} mb = {{ base: 4, lg: 0 }}>
        <Heading size = "md" color = "white">
          Navigation
        </Heading>
      </Flex>

      <Flex align = "center">
        <IconButton d = {{ base: 'flex', lg: 'none' }}
          mb = {{ base: 4, lg: 0 }}
          aria-label = "Open menu"
          variant = "ghost"
          icon = {isOpen ? <FiX /> : <FiMenu />}
          onClick = {onToggle}
        />
      </Flex>

      <Box d = {{ base: isOpen ? 'flex' : 'none', lg: 'block' }}
        flexDirection = {{ base: 'column' }}
        width = {{ base: 'full' }}
        mb = {{ base: 4, lg: 0 }}
      >
        <VStack px = {2}>
          <Link href = {`/guilds/${id}`}>
            <Button w = "100%"
              variant = {router.route === '/guilds/[id]' ? 'solid' : 'ghost'}
              color = {router.route === '/guilds/[id]' ? blue : 'theme'}
              bg = {gray}
              textAlign = "left"
            >
              <Text w = "100%">
                Dashboard
              </Text>
            </Button>
          </Link>

          <Text fontWeight = "semibold" w = "100%"
            pt = {2}>
            Modules
          </Text>

          <Box w = "100%">
            <Link href = {`/guilds/${id}/modules/automoderation`}>
              <Button variant = "ghost"
                color = {router.route === '/guilds/[id]/modules/automoderation' ? blue : 'theme'}
                bg = {gray}
                textAlign = "left"
                w = "100%"
              >
                <Text w = "100%">
                  Auto Moderation
                </Text>
              </Button>
            </Link>
          </Box>

          <Box w = "100%">
            <Link href = {`/guilds/${id}/modules/logging`}>
              <Button variant = "ghost"
                color = {router.route === '/guilds/[id]/modules/logging' ? blue : 'theme'}
                bg = {gray}
                textAlign = "left"
                w = "100%"
              >
                <Text w = "100%">
                  Logging
                </Text>
              </Button>
            </Link>
          </Box>

          <IconButton onClick = {toggleColorMode}
            variant = "ghost"
            icon = {icon}
            aria-label = "Toggle Theme" />
        </VStack>
      </Box>
    </Flex>
  );
};

export default GuildNavbar;
