<template>
  <div class="imprint-page">
    <div class="imprint-page__top">
      <div class="imprint-page__label">Imprint</div>
      <h1 class="imprint-page__heading">Legal &amp; privacy</h1>
    </div>

    <div class="imprint-page__body">
      <div class="imprint-page__spacer" aria-hidden="true" />
      <div class="imprint-page__text">
        <section class="imprint-section">
          <h2 class="imprint-section__title">Site operator</h2>
          <p>
            This website is operated by Emma Portner, an individual based in
            Canada. It presents artistic and professional work and related
            information.
          </p>
          <p>
            For inquiries about this site or privacy matters, please use the
            contact details published on the
            <NuxtLink to="/info">Info</NuxtLink> page or other public
            professional channels associated with Emma Portner.
          </p>
        </section>

        <section class="imprint-section">
          <h2 class="imprint-section__title">Privacy (Canada)</h2>
          <p>
            This notice is intended to meet expectations under Canada’s federal
            privacy framework (including PIPEDA, where it applies) for a small
            personal / portfolio website. We do not run a separate advertising
            or marketing-analytics product on top of the site.
          </p>
          <p>
            We do not intentionally collect personal information through this
            site: there are no contact forms, newsletters, user accounts, or
            login systems on these pages.
          </p>
          <p>
            You may request information about any personal information we hold
            about you in connection with this website, and request correction
            where appropriate, by contacting us through the channels noted
            above.
          </p>
        </section>

        <section class="imprint-section">
          <h2 class="imprint-section__title">Cookies &amp; local storage</h2>
          <p>
            This site does not set its own tracking or advertising cookies, and
            it does not embed third-party marketing tags in the project code.
          </p>
          <p>
            Hosting and security providers may still set strictly necessary or
            functional cookies (for example to deliver the site over HTTPS or
            apply bot protection). See the Cloudflare section below.
          </p>
        </section>

        <section class="imprint-section">
          <h2 class="imprint-section__title">Hosting (Cloudflare)</h2>
          <p>
            The website is hosted and delivered through Cloudflare (including
            Cloudflare Pages and Cloudflare’s content delivery network). When
            you visit, your browser connects to Cloudflare’s infrastructure.
            Cloudflare may process technical data such as IP address, browser
            type, approximate location derived from IP, requested URLs, and
            timestamps in order to serve the site, keep it secure, and operate
            the network.
          </p>
          <p>
            Cloudflare may also provide the site operator with aggregate or
            request-level traffic insights (for example visits, bandwidth, and
            error rates) through the Cloudflare dashboard. That is platform
            telemetry for running the site, not a separate advertising pixel
            we installed. Cloudflare’s own privacy policy applies to data it
            processes as a service provider.
          </p>
          <p>
            More information:
            <a
              href="https://www.cloudflare.com/privacypolicy/"
              target="_blank"
              rel="noopener noreferrer"
              >cloudflare.com/privacypolicy</a
            >.
          </p>
        </section>

        <section class="imprint-section">
          <h2 class="imprint-section__title">Domain (GoDaddy)</h2>
          <p>
            The domain name for this site is registered with GoDaddy. Domain
            registration involves registrant contact details held by the
            registrar (and, where published, public WHOIS / registration
            directories). Routine DNS and registration services are operated by
            GoDaddy under its own terms and privacy policy; visiting this
            website does not by itself create a GoDaddy account for you.
          </p>
          <p>
            More information:
            <a
              href="https://www.godaddy.com/legal/agreements/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              >GoDaddy privacy policy</a
            >.
          </p>
        </section>

        <section class="imprint-section">
          <h2 class="imprint-section__title">Content hosting (Sanity)</h2>
          <p>
            Project text, images, and related media metadata are requested from
            Sanity’s content service so the site can display up-to-date work.
            That is a server-to-browser content fetch, not a visitor account or
            mailing list.
          </p>
        </section>

        <section class="imprint-section">
          <h2 class="imprint-section__title">Video (Vimeo)</h2>
          <p>
            Selected project videos are streamed from Vimeo (and Vimeo’s content
            delivery network). When you open a project and play a video, your
            browser connects to Vimeo’s servers to retrieve the media. Vimeo may
            process technical data required to deliver and protect the stream
            under its own terms and privacy policy.
          </p>
          <p>
            Please review Vimeo’s privacy information at
            <a
              href="https://vimeo.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              >vimeo.com/privacy</a
            >
            for details of how Vimeo handles data.
          </p>
        </section>

        <section class="imprint-section">
          <h2 class="imprint-section__title">External links</h2>
          <p>
            This site may link to third-party websites. Those sites are outside
            our control; their privacy and legal terms apply once you leave
            this domain.
          </p>
        </section>

        <section class="imprint-section">
          <h2 class="imprint-section__title">Intellectual property</h2>
          <p>
            Unless otherwise noted, text, images, video, and design on this
            site are protected by copyright and related rights belonging to
            Emma Portner and/or the credited collaborators. You may view the
            site for personal, non-commercial use. Reproduction, distribution,
            or other use beyond that requires prior permission, except where
            Canadian fair dealing or other applicable exceptions allow.
          </p>
        </section>

        <section class="imprint-section">
          <h2 class="imprint-section__title">Governing law</h2>
          <p>
            This website and these notices are governed by the laws of Canada
            and the applicable laws of the province or territory in which Emma
            Portner resides, without regard to conflict-of-law rules.
          </p>
        </section>

        <section class="imprint-section">
          <h2 class="imprint-section__title">Updates</h2>
          <p>
            This page may be updated from time to time to reflect how the site
            works. The version published on this URL is the current one.
          </p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from "vue";

definePageMeta({
  path: "/imprint",
  key: "imprint-page",
});

useSeoMeta({
  title: "Imprint",
  ogTitle: "Emma Portner - Imprint",
  twitterTitle: "Emma Portner - Imprint",
  description: "Legal notice and privacy information for emmaportner.com",
  robots: "index, follow",
});

onMounted(() => {
  document.documentElement.classList.add("imprint-route");
  document.body.classList.add("imprint-route");
});

onUnmounted(() => {
  document.documentElement.classList.remove("imprint-route");
  document.body.classList.remove("imprint-route");
});
</script>

<style scoped>
.imprint-page {
  min-height: 100%;
  padding: 72px 20px 64px;
  color: #000;
}

.imprint-page__top {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: end;
  padding-bottom: 5px;
  margin-bottom: 5px;
  border-bottom: 1px solid #000;
}

.imprint-page__heading {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

.imprint-page__body {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.imprint-page__text {
  min-width: 0;
}

.imprint-section {
  margin: 0 0 10px;
}

.imprint-section__title {
  margin: 0 0 10px;
  font-size: inherit;
  font-weight: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.imprint-section p {
  margin: 0 0 10px;
}

.imprint-section p:last-child {
  margin-bottom: 0;
}

.imprint-section a {
  text-underline-offset: 2px;
}

@media (max-width: 768px) {
  .imprint-page {
    padding: 88px 20px 48px;
  }

  .imprint-page__top {
    grid-template-columns: auto 1fr;
    column-gap: 10px;
  }

  .imprint-page__body {
    grid-template-columns: 1fr;
  }

  .imprint-page__spacer {
    display: none;
  }
}
</style>

<style>
html.imprint-route,
body.imprint-route {
  overflow: auto;
  height: auto;
  min-height: 100%;
}

body.imprint-route .app {
  height: auto;
  min-height: 100%;
}
</style>
