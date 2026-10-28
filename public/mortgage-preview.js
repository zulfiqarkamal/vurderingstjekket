// This local reconstruction has no Worker, Stripe injection or live data.
// Block all fetches rather than sending mortgage requests to Railway APIs.
window.fetch = async function () {
  throw new Error('Eksterne tjenester er afkoblet i den lokale forhåndsvisning.');
};
window.addEventListener('DOMContentLoaded', () => {
  const notice = () => alert('Denne funktion kræver den eksisterende Cloudflare-app. Ingen oplysninger er sendt, og ingen betaling er startet.');
  window.payCard = notice;
  window.startSubscription = notice;
  window.sendPakke = notice;
  window.handleScreenshotUpload = notice;
  window.dawaSearch = () => { document.getElementById('dawaDrop').style.display = 'none'; };
  setSource('manuel');
  document.getElementById('srcVt').hidden = true;
  document.getElementById('adresse').value = '';
  document.querySelector('.vt-cta').hidden = true;
  document.getElementById('adresseM').placeholder = 'Skriv adressen manuelt (ingen live adressesøgning)';
  document.getElementById('adresseM').insertAdjacentHTML('afterend', '<p class="field-hint">Lokal forhåndsvisning: brug fiktive oplysninger. Renter og beregninger er eksempler, ikke aktuelle markedstilbud. Upload, bankafsendelse og betaling er afkoblet.</p>');
});
