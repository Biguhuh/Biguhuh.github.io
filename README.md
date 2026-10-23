# Biguhuh.github.io

Page sommaire listant mes projets web publiés sur GitHub Pages : https://biguhuh.github.io/

La page est découpée en deux sections : **Environnement et santé** et **Autres**. Pour ajouter un
projet, éditer `index.html` et ajouter une carte dans la grille de la bonne section.

`cartes-egalim.html` ne fait plus que rediriger vers la galerie des cartes EGALIM, désormais
publiée par le dépôt `map_cantines_egalim` (https://biguhuh.github.io/map_cantines_egalim/cartes/).

## Poussières

`poussieres/` est une copie du site construit depuis le dépôt privé `poussieres` (le code reste
privé, seul le site est publié). Pour le mettre à jour :

```bash
cd ~/code/Biguhuh/poussieres && python outils/construire_site.py
rm -rf ../Biguhuh.github.io/poussieres && cp -r _site ../Biguhuh.github.io/poussieres
```

## Licence

Ce site est sous licence MIT (voir [LICENSE](LICENSE)) : tu peux le réutiliser librement, en gardant la mention de copyright.

Chaque projet a sa propre licence :

| Projet | Licence |
|---|---|
| [votes_parlementaires](https://github.com/Biguhuh/votes_parlementaires) | MIT (code) |
| [map_cantines_egalim](https://github.com/Biguhuh/map_cantines_egalim) | MIT (code) |
| [cancer](https://github.com/Biguhuh/cancer) | CC BY 4.0 (textes et analyses), MIT (code) |
